import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
function harness() {
  const handlers = {}, storage = new Map(), fetched = [];
  const scope = 'https://example.test/traceback/';
  const caches = {
    async open(name) {
      if (!storage.has(name)) storage.set(name, new Map());
      const entries = storage.get(name);
      return {
        async addAll(urls) { for (const url of urls) entries.set(url, { url, cached: true }); },
        async match(request, options = {}) {
          let url = typeof request === 'string' ? request : request.url;
          if (options.ignoreSearch) { const value = new URL(url); value.search = ''; url = value.href; }
          return entries.get(url);
        }
      };
    },
    async keys() { return [...storage.keys()]; },
    async delete(name) { return storage.delete(name); }
  };
  vm.runInNewContext(source, {
    URL, caches,
    fetch: async request => { fetched.push(request); throw new Error('Network disconnected'); },
    self: { registration: { scope }, location: { origin: 'https://example.test' }, clients: { async claim() {} }, addEventListener: (name, handler) => { handlers[name] = handler; } }
  });
  const lifecycle = async name => { let pending; handlers[name]({ waitUntil(value) { pending = value; } }); await pending; };
  const request = async (url, overrides = {}) => {
    let pending; handlers.fetch({ request: { url, method: 'GET', mode: 'cors', ...overrides }, respondWith(value) { pending = value; } });
    return pending;
  };
  return { scope, storage, fetched, lifecycle, request };
}
test('offline shell and worker modules resolve from a scoped cache', async () => {
  const app = harness(); await app.lifecycle('install'); await app.lifecycle('activate');
  const shell = await app.request(app.scope + '?v=1', { mode: 'navigate' });
  assert.equal(shell.url, app.scope + 'index.html');
  assert.equal((await app.request(app.scope + 'js/processor.worker.js')).cached, true);
  assert.equal((await app.request(app.scope + 'data/sample-incident.json?cache=1')).cached, true);
  assert.equal(app.fetched.length, 0);
});
test('service worker ignores other origins, scopes, and mutations', async () => {
  const app = harness(); await app.lifecycle('install');
  assert.equal(await app.request('https://elsewhere.test/data'), undefined);
  assert.equal(await app.request('https://example.test/other/index.html', { mode: 'navigate' }), undefined);
  assert.equal(await app.request(app.scope + 'js/app.js', { method: 'POST' }), undefined);
  assert.equal(await app.request(app.scope + 'unlisted.json'), undefined);
});
test('activation deletes only this deployment’s older caches', async () => {
  const app = harness();
  const prefix = 'traceback-' + encodeURIComponent(app.scope) + '-';
  app.storage.set(prefix + 'v0', new Map()); app.storage.set('another-application', new Map());
  await app.lifecycle('install'); await app.lifecycle('activate');
  assert.equal(app.storage.has(prefix + 'v0'), false);
  assert.equal(app.storage.has(prefix + 'v1'), true);
  assert.equal(app.storage.has('another-application'), true);
});
