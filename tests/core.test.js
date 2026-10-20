import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseLogText, parseTimestamp, defaultView, sanitizeView, makeSearchIndex, queryEvents, virtualWindow, exportWorkspace, MAX_BYTES } from '../public/js/core.js';
const record = (id, offset = 0, extra = {}) => ({ id, timestamp: new Date(Date.UTC(2026, 5, 14) + offset).toISOString(), service: 'api', level: 'info', message: 'Request completed', ...extra });
test('JSON and JSONL normalize aliases, sort records, and have the same content ID', async () => {
  const records = [record('b', 1000, { level: 'warning', trace_id: 'trace-1' }), record('a', 0)];
  const json = await parseLogText(JSON.stringify(records), 'test.json');
  const jsonl = await parseLogText(records.map(event => JSON.stringify(event)).join('\n'));
  assert.equal(json.dataset.id, jsonl.dataset.id);
  assert.equal(json.dataset.events[0].id, 'a');
  assert.equal(json.dataset.events[1].level, 'warn');
  assert.equal(json.dataset.events[1].traceId, 'trace-1');
  assert.equal(json.dataset.title, 'test');
});
test('single-line JSONL and epoch timestamps work', async () => {
  const result = await parseLogText(JSON.stringify({ timestamp: 0, message: 'Epoch' }));
  assert.equal(result.dataset.events[0].ts, 0);
  assert.equal(result.dataset.events[0].service, 'unknown');
});
test('calendar validation rejects impossible and ambiguous dates', () => {
  assert.equal(parseTimestamp('2024-02-29T12:00:00+02:00'), Date.parse('2024-02-29T10:00:00Z'));
  for (const value of ['2025-02-29T00:00:00Z', '2026-02-31T00:00:00Z', '2026-01-01T24:00:00Z', '2026-01-01T00:00:00', 'yesterday', Infinity, -1, 0.1]) assert.throws(() => parseTimestamp(value));
});
test('invalid records fail with actionable messages', async () => {
  await assert.rejects(parseLogText(''), /empty/);
  await assert.rejects(parseLogText('[]'), /at least one/);
  await assert.rejects(parseLogText('{}'), /events array/);
  await assert.rejects(parseLogText('{"timestamp":"bad"}'), /Event 1/);
  await assert.rejects(parseLogText(JSON.stringify([record('a'), record('a')])), /Duplicate/);
  await assert.rejects(parseLogText(JSON.stringify([record('a', 0, { level: 'oops' })])), /severity/);
  await assert.rejects(parseLogText(JSON.stringify([record('a', 0, { durationMs: -2 })])), /nonnegative/);
  await assert.rejects(parseLogText(JSON.stringify([record('a', 0, { metadata: [] })])), /metadata/);
  await assert.rejects(parseLogText(' '.repeat(MAX_BYTES + 1)), /20 MiB/);
  await assert.rejects(parseLogText(JSON.stringify({ format: 'traceback-investigation', version: 2, events: [record('a')] })), /unsupported version/);
});
test('export preserves bookmarks, notes, metadata, and reproducible dataset identity', async () => {
  const records = [record('__proto__', 0, { metadata: { nested: { safe: '<script>alert(1)</script>' } } }), record('b', 2000)];
  const input = JSON.parse(JSON.stringify({ events: records, notes: { ['__proto__']: 'Important', ghost: 'discard' }, bookmarks: ['b', 'b', 'missing'] }));
  const result = await parseLogText(JSON.stringify(input));
  assert.equal(Object.getPrototypeOf(result.workspace.notes), Object.prototype);
  assert.equal(result.workspace.notes.__proto__, 'Important');
  assert.deepEqual(result.workspace.bookmarks, ['b']);
  assert.equal(Object.hasOwn(result.workspace.notes, 'ghost'), false);
  const roundTrip = await parseLogText(JSON.stringify(exportWorkspace(result.dataset, result.workspace, defaultView(result.dataset))));
  assert.equal(result.dataset.id, roundTrip.dataset.id);
  assert.deepEqual(roundTrip.workspace.notes, result.workspace.notes);
});
test('combined filters, replay boundaries, and full-window histogram agree', async () => {
  const { dataset } = await parseLogText(JSON.stringify([
    record('a', 0), record('b', 1000, { service: 'payments', level: 'error', traceId: 't42' }),
    record('c', 2000, { service: 'payments', level: 'warn', metadata: { region: 'east' } }),
    record('d', 3000, { service: 'payments', level: 'critical', traceId: 't42' })
  ]));
  const base = defaultView(dataset), index = makeSearchIndex(dataset.events);
  const result = queryEvents(dataset, { ...base, services: ['payments'], levels: ['error', 'critical'], query: 'T42', cursor: dataset.start + 1000 }, [], index);
  assert.deepEqual([...result.indices], [1]); assert.equal(result.matching, 2); assert.equal(result.errorCount, 2);
  assert.equal(result.bins.reduce((sum, bin) => sum + bin.error, 0), 2);
  assert.equal(result.bins.at(-1).error, 1);
  assert.deepEqual([...queryEvents(dataset, { ...base, query: 'east' }, [], index).indices], [2]);
  assert.deepEqual([...queryEvents(dataset, { ...base, bookmarksOnly: true }, ['c'], index).indices], [2]);
  assert.equal(queryEvents(dataset, { ...base, query: 'no match' }, [], index).matching, 0);
});
test('single timestamp and sanitized hostile view parameters remain valid', async () => {
  const { dataset } = await parseLogText(JSON.stringify([record('a')]));
  const view = sanitizeView({ from: -1, to: -2, cursor: Infinity, speed: 999, services: ['fake', 'api', 'api'], levels: ['invalid'], selectedId: 'missing', query: 'x'.repeat(500) }, dataset);
  assert.equal(view.from, dataset.start); assert.equal(view.to, dataset.end); assert.equal(view.cursor, dataset.end);
  assert.equal(view.speed, 30); assert.deepEqual(view.services, ['api']); assert.equal(view.selectedId, '');
  assert.equal(view.query.length, 300);
  assert.equal(queryEvents(dataset, defaultView(dataset)).bins[0].info, 1);
});
test('virtualization bounds DOM work to the viewport and overscan', () => {
  const result = virtualWindow(100000, 640000, 640);
  assert.equal(result.start, 9995); assert.equal(result.end, 10015); assert.equal(result.total, 6400000);
  assert.deepEqual(virtualWindow(0, 0, 640), { start: 0, end: 0, offset: 0, total: 0 });
  const last = virtualWindow(100000, 6399900, 640);
  assert.equal(last.end, 100000); assert.ok(last.start <= last.end);
});
test('100,000 records produce correct typed index results without DOM-sized output', async () => {
  const records = Array.from({ length: 100000 }, (_, i) => ({ id: String(i), timestamp: i * 1000, service: i % 2 ? 'api' : 'db', level: i % 10 ? 'info' : 'error', message: 'event' }));
  const { dataset } = await parseLogText(JSON.stringify(records));
  const result = queryEvents(dataset, { ...defaultView(dataset), services: ['db'], levels: ['error'] });
  assert.equal(dataset.count, 100000); assert.equal(result.matching, 10000); assert.ok(result.indices instanceof Uint32Array);
  assert.equal(result.indices.at(-1), 99990);
  await assert.rejects(parseLogText(JSON.stringify([...records, { ...records[0], id: 'extra' }])), /more than/);
});
test('bundled sample contains complete incident phases and six services', async () => {
  const { dataset, workspace } = await parseLogText(await readFile(new URL('../public/data/sample-incident.json', import.meta.url), 'utf8'));
  assert.equal(dataset.count, 1084); assert.equal(dataset.services.length, 6);
  assert.equal(workspace.bookmarks.length, 4);
  assert.ok(dataset.counts.error > 0); assert.ok(dataset.counts.critical > 0);
});
