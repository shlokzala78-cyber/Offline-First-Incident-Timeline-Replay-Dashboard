import test from 'node:test';
import assert from 'node:assert/strict';
import { ViewHistory } from '../public/js/history.js';
import { encodeView, decodeView } from '../public/js/view-state.js';
import { resolvePublicPath, publicRoot } from '../server.mjs';
import { join } from 'node:path';
test('undo/redo clones state, trims history, and discards the redo branch', () => {
  const history = new ViewHistory({ query: '', services: [] }, 2);
  const next = { query: 'a', services: ['api'] }; history.commit(next); next.services.push('db');
  history.commit({ query: 'b' }); history.commit({ query: 'c' });
  assert.deepEqual(history.undo(), { query: 'b' });
  assert.deepEqual(history.undo(), { query: 'a', services: ['api'] });
  assert.equal(history.undo(), null); assert.equal(history.canUndo, false);
  assert.deepEqual(history.redo(), { query: 'b' });
  history.commit({ query: 'new' }); assert.equal(history.canRedo, false);
  assert.equal(history.commit({ query: 'new' }), false);
});
test('view links preserve punctuation and reject malformed versions or datasets', () => {
  const id = 'abcdef0123456789abcdef01';
  const view = { query: 'error & café / = ?', services: ['api/gateway', 'billing & tax'], levels: ['error'], from: 1, to: 10, cursor: 5, selectedId: 'a b#c', bookmarksOnly: true, speed: 60 };
  assert.deepEqual(decodeView(encodeView(id, view)), { datasetId: id, view });
  assert.equal(decodeView('#v=2&dataset=' + id), null);
  assert.equal(decodeView('#v=1&dataset=invalid'), null);
  assert.deepEqual(decodeView('#v=1&dataset=' + id + '&services=bad').view.services, []);
});
test('static paths stay inside public and reject encoded traversal', () => {
  assert.equal(resolvePublicPath('/js/app.js?x=1'), join(publicRoot, 'js/app.js'));
  assert.equal(resolvePublicPath('/../../package.json'), null);
  assert.equal(resolvePublicPath('/%2e%2e/%2e%2e/package.json'), null);
  assert.equal(resolvePublicPath('/%00'), null);
  assert.equal(resolvePublicPath('/%ZZ'), null);
  assert.equal(resolvePublicPath('/..\\secret'), null);
});
