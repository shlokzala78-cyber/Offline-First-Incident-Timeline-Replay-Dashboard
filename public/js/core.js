export const LEVELS = ['critical', 'error', 'warn', 'info', 'debug'];
export const MAX_EVENTS = 100000;
export const MAX_BYTES = 20 * 1024 * 1024;

function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function text(value, name, limit, fallback = '') {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string' || value.length > limit) throw new Error(`${name} must be text up to ${limit} characters.`);
  return value;
}

export function parseTimestamp(value) {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 253402300799999) return value;
  const parts = typeof value === 'string' && value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/i);
  if (!parts) {
    throw new Error('timestamp must be ISO 8601 with a timezone, or milliseconds since the Unix epoch.');
  }
  const [, year, month, day, hour, minute, second] = parts.map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59 || second > 59) throw new Error('timestamp is not a valid calendar date.');
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error('timestamp is not a valid date.');
  return ms;
}

export function normalizeEvent(input, index) {
  if (!object(input)) throw new Error('Each event must be a JSON object.');
  const ts = parseTimestamp(input.timestamp ?? input.ts);
  const level = text(input.level ?? input.severity, 'level', 20, 'info').toLowerCase();
  const normalizedLevel = level === 'warning' ? 'warn' : level === 'fatal' ? 'critical' : level;
  if (!LEVELS.includes(normalizedLevel)) throw new Error(`Unknown severity "${level}".`);
  const service = text(input.service, 'service', 80, 'unknown').trim() || 'unknown';
  const id = text(input.id, 'id', 160, `event-${index + 1}`);
  if (!id) throw new Error('Event IDs cannot be empty.');
  const message = text(input.message, 'message', 8000, '(no message)');
  const traceId = text(input.traceId ?? input.trace_id, 'traceId', 160);
  const durationMs = input.durationMs ?? input.duration_ms ?? null;
  if (durationMs !== null && (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0)) throw new Error('durationMs must be a nonnegative number.');
  const metadata = input.metadata ?? {};
  if (!object(metadata)) throw new Error('metadata must be a JSON object.');
  return { id, ts, timestamp: new Date(ts).toISOString(), service, level: normalizedLevel, message, traceId, durationMs, metadata };
}

export async function parseLogText(raw, fileName = 'Imported incident') {
  if (new TextEncoder().encode(raw).byteLength > MAX_BYTES) throw new Error('This file exceeds the 20 MiB import limit.');
  const clean = raw.replace(/^\uFEFF/, '').trim();
  if (!clean) throw new Error('This file is empty.');
  let source;
  try { source = JSON.parse(clean); }
  catch {
    const lines = clean.split(/\r?\n/).filter(line => line.trim());
    try { source = lines.map((line, index) => { try { return JSON.parse(line); } catch { throw new Error(`Invalid JSON on line ${index + 1}.`); } }); }
    catch (error) { throw new Error(`Could not read JSON or JSONL. ${error.message}`); }
  }
  const bundle = object(source) ? source : {};
  if (bundle.format === 'traceback-investigation' && bundle.version !== 1) throw new Error('This investigation export uses an unsupported version.');
  const records = Array.isArray(source) ? source : bundle.events ?? ((bundle.timestamp !== undefined || bundle.ts !== undefined) ? [bundle] : undefined);
  if (!Array.isArray(records)) throw new Error('Use a JSON event array, JSONL, or an object with an events array.');
  if (!records.length) throw new Error('The file must contain at least one event.');
  if (records.length > MAX_EVENTS) throw new Error(`The file contains more than ${MAX_EVENTS.toLocaleString()} events.`);
  const ids = new Set();
  const events = records.map((event, index) => {
    let normalized;
    try { normalized = normalizeEvent(event, index); } catch (error) { throw new Error(`Event ${index + 1}: ${error.message}`); }
    if (ids.has(normalized.id)) throw new Error(`Duplicate event ID: ${normalized.id}`);
    ids.add(normalized.id);
    return normalized;
  }).sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(events)));
  const id = [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('').slice(0, 24);
  const title = text(bundle.title, 'title', 120, fileName.replace(/\.(jsonl?|ndjson)$/i, '') || 'Imported incident');
  const counts = Object.fromEntries(LEVELS.map(level => [level, 0]));
  const services = new Map();
  for (const event of events) {
    counts[event.level]++;
    const service = services.get(event.service) ?? { name: event.service, count: 0, errors: 0 };
    service.count++;
    if (event.level === 'error' || event.level === 'critical') service.errors++;
    services.set(event.service, service);
  }
  if (services.size > 100) throw new Error('A single investigation supports up to 100 services.');
  const notes = {};
  if (object(bundle.notes)) for (const [key, value] of Object.entries(bundle.notes)) {
    if (ids.has(key) && typeof value === 'string') Object.defineProperty(notes, key, { value: value.slice(0, 4000), enumerable: true, configurable: true, writable: true });
  }
  const bookmarks = Array.isArray(bundle.bookmarks) ? [...new Set(bundle.bookmarks.filter(id => ids.has(id)))] : [];
  return {
    dataset: { id, title, events, count: events.length, start: events[0].ts, end: events.at(-1).ts, counts, services: [...services.values()].sort((a, b) => b.errors - a.errors || a.name.localeCompare(b.name)), importedAt: Date.now() },
    workspace: { notes, bookmarks, view: object(bundle.view) ? bundle.view : null }
  };
}

export function defaultView(dataset) {
  return { query: '', services: [], levels: [], from: dataset.start, to: dataset.end, cursor: dataset.end, selectedId: '', bookmarksOnly: false, speed: 30 };
}

export function sanitizeView(input, dataset) {
  const base = defaultView(dataset);
  if (!input || typeof input !== 'object') return base;
  const names = new Set(dataset.services.map(s => s.name));
  const clamp = value => Math.min(dataset.end, Math.max(dataset.start, Number(value)));
  const from = Number.isFinite(Number(input.from)) ? clamp(input.from) : base.from;
  const to = Number.isFinite(Number(input.to)) ? Math.max(from, clamp(input.to)) : base.to;
  return {
    query: typeof input.query === 'string' ? input.query.slice(0, 300) : '',
    services: Array.isArray(input.services) ? [...new Set(input.services.filter(s => names.has(s)))] : [],
    levels: Array.isArray(input.levels) ? [...new Set(input.levels.filter(s => LEVELS.includes(s)))] : [],
    from, to, cursor: Number.isFinite(Number(input.cursor)) ? Math.max(from, Math.min(to, Number(input.cursor))) : to,
    selectedId: typeof input.selectedId === 'string' && dataset.events.some(e => e.id === input.selectedId) ? input.selectedId : '',
    bookmarksOnly: input.bookmarksOnly === true,
    speed: [1, 10, 30, 60, 120].includes(Number(input.speed)) ? Number(input.speed) : 30
  };
}

export function makeSearchIndex(events) {
  return events.map(event => [event.id, event.service, event.message, event.traceId, JSON.stringify(event.metadata)].join(' ').toLowerCase());
}

export function queryEvents(dataset, view, bookmarks = [], searchIndex = makeSearchIndex(dataset.events)) {
  const services = new Set(view.services), levels = new Set(view.levels), marked = new Set(bookmarks);
  const query = view.query.trim().toLowerCase();
  const indices = [], bins = Array.from({ length: 80 }, () => ({ info: 0, warn: 0, error: 0 }));
  let matching = 0, errorCount = 0;
  const span = Math.max(1, view.to - view.from);
  for (let i = 0; i < dataset.events.length; i++) {
    const event = dataset.events[i];
    if (event.ts < view.from || event.ts > view.to || (services.size && !services.has(event.service)) || (levels.size && !levels.has(event.level)) || (view.bookmarksOnly && !marked.has(event.id)) || (query && !searchIndex[i].includes(query))) continue;
    matching++;
    const group = ['error', 'critical'].includes(event.level) ? 'error' : event.level === 'warn' ? 'warn' : 'info';
    if (group === 'error') errorCount++;
    bins[Math.min(79, Math.floor((event.ts - view.from) / span * 80))][group]++;
    if (event.ts <= view.cursor) indices.push(i);
  }
  return { indices: Uint32Array.from(indices), bins, matching, errorCount };
}

export function virtualWindow(length, scrollTop, height, rowHeight = 64, overscan = 5) {
  const start = Math.max(0, Math.min(length, Math.floor(Math.max(0, scrollTop) / rowHeight) - overscan));
  const end = Math.min(length, Math.ceil((Math.max(0, scrollTop) + Math.max(0, height)) / rowHeight) + overscan);
  return { start, end: Math.max(start, end), offset: start * rowHeight, total: length * rowHeight };
}

export function exportWorkspace(dataset, workspace, view) {
  return { format: 'traceback-investigation', version: 1, title: dataset.title, events: dataset.events.map(({ ts, ...event }) => event), notes: workspace.notes, bookmarks: workspace.bookmarks, view };
}
