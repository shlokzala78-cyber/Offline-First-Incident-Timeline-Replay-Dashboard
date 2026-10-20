import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { defaultView } from '../public/js/core.js';
test('worker protocol parses, filters, transfers indices, and survives malformed input', async () => {
  const worker = new Worker(new URL('./worker-bridge.mjs', import.meta.url));
  try {
    const [ready] = await once(worker, 'message'); assert.equal(ready.ready, true);
    let next = 0;
    async function request(type, payload) {
      const response = once(worker, 'message'); worker.postMessage({ id: ++next, type, payload });
      const [message] = await response; assert.equal(message.id, next); return message;
    }
    const parsed = await request('parse', { text: JSON.stringify([{ id: 'one', timestamp: 0, level: 'error', message: 'test' }]), name: 'Test.json' });
    assert.equal(parsed.result.dataset.title, 'Test');
    const result = await request('query', { view: defaultView(parsed.result.dataset), bookmarks: [] });
    assert.ok(result.result.indices instanceof Uint32Array); assert.deepEqual([...result.result.indices], [0]);
    const invalid = await request('parse', { text: '[]', name: 'bad.json' }); assert.match(invalid.error, /at least one/);
    const after = await request('query', { view: defaultView(parsed.result.dataset), bookmarks: [] });
    assert.equal(after.result.matching, 1);
    const loaded = await request('load', parsed.result.dataset); assert.equal(loaded.result, true);
    assert.match((await request('missing', {})).error, /Unknown/);
  } finally { await worker.terminate(); }
});
