import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { Repository } from '../public/js/db.js';
test('investigations and workspaces survive repository reopen and delete atomically', async () => {
  const factory = new IDBFactory(), repo = new Repository(factory);
  const data = { id: 'one', title: 'First', events: [{ id: 'a' }], importedAt: 1 };
  await repo.saveDataset(data, { notes: { a: 'follow up' }, bookmarks: ['a'], view: { query: 'error' } });
  await repo.saveDataset({ id: 'two', title: 'Second', events: [], importedAt: 2 }, { notes: {}, bookmarks: [] });
  assert.deepEqual((await repo.list()).map(item => item.id), ['two', 'one']);
  assert.equal(Object.hasOwn((await repo.list())[0], 'events'), false);
  await repo.saveWorkspace('one', { notes: { a: 'updated' }, bookmarks: [], view: { cursor: 42 } });
  repo.close();
  const reopened = new Repository(factory);
  const saved = await reopened.get('one');
  assert.equal(saved.dataset.title, 'First'); assert.equal(saved.workspace.notes.a, 'updated');
  assert.equal(saved.workspace.view.cursor, 42); assert.equal(await reopened.last(), 'one');
  await reopened.remove('two'); assert.equal(await reopened.last(), 'one');
  await reopened.remove('one');
  assert.equal(await reopened.last(), undefined); assert.equal((await reopened.list()).length, 0);
  assert.equal((await reopened.get('one')).workspace, undefined);
  reopened.close();
});
test('failed structured clones roll back dataset and workspace in a single transaction', async () => {
  const repo = new Repository(new IDBFactory());
  await assert.rejects(repo.saveDataset({ id: 'bad', importedAt: 1 }, { notes: { callback: () => {} } }));
  assert.equal((await repo.get('bad')).dataset, undefined);
  assert.equal(await repo.last(), undefined); repo.close();
});
test('missing IndexedDB produces an actionable storage error', async () => {
  await assert.rejects(new Repository(null).open(), /cannot be saved/);
});
