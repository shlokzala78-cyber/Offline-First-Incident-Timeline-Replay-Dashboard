const NAME = 'traceback-workbench';
const VERSION = 1;
export class Repository {
  constructor(factory = globalThis.indexedDB, name = NAME) { this.factory = factory; this.name = name; this.db = null; }
  async open() {
    if (!this.factory) throw new Error('This browser does not expose IndexedDB. Your work cannot be saved here.');
    if (this.db) return this;
    this.db = await new Promise((resolve, reject) => {
      const request = this.factory.open(this.name, VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('datasets')) db.createObjectStore('datasets', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('workspaces')) db.createObjectStore('workspaces', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Close other Traceback tabs, then reload to update local storage.'));
    });
    this.db.onversionchange = () => { this.db.close(); this.db = null; };
    return this;
  }
  async transaction(stores, mode, perform) {
    await this.open();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(stores, mode);
      let value;
      transaction.oncomplete = () => resolve(value);
      transaction.onabort = () => reject(transaction.error ?? new Error('Local storage transaction was interrupted.'));
      transaction.onerror = () => {};
      try { perform(transaction, next => { value = next; }); }
      catch (error) { transaction.abort(); reject(error); }
    });
  }
  get(id) { return this.transaction(['datasets', 'workspaces'], 'readonly', (tx, set) => {
    const data = {}, dataset = tx.objectStore('datasets').get(id), workspace = tx.objectStore('workspaces').get(id);
    dataset.onsuccess = () => { data.dataset = dataset.result; set(data); };
    workspace.onsuccess = () => { data.workspace = workspace.result; set(data); };
  }); }
  list() { return this.transaction(['datasets'], 'readonly', (tx, set) => {
    const cursor = tx.objectStore('datasets').openCursor(), items = [];
    cursor.onsuccess = () => { const row = cursor.result; if (!row) { set(items.sort((a, b) => b.importedAt - a.importedAt)); return; } const { events, ...summary } = row.value; items.push(summary); row.continue(); };
  }); }
  saveDataset(dataset, workspace) { return this.transaction(['datasets', 'workspaces', 'meta'], 'readwrite', tx => {
    tx.objectStore('datasets').put(dataset);
    tx.objectStore('workspaces').put({ ...workspace, id: dataset.id, savedAt: Date.now() });
    tx.objectStore('meta').put(dataset.id, 'lastDataset');
  }); }
  saveWorkspace(id, workspace) { return this.transaction(['workspaces', 'meta'], 'readwrite', tx => {
    tx.objectStore('workspaces').put({ ...workspace, id, savedAt: Date.now() }); tx.objectStore('meta').put(id, 'lastDataset');
  }); }
  last() { return this.transaction(['meta'], 'readonly', (tx, set) => { const request = tx.objectStore('meta').get('lastDataset'); request.onsuccess = () => set(request.result); }); }
  remove(id) { return this.transaction(['datasets', 'workspaces', 'meta'], 'readwrite', tx => {
    tx.objectStore('datasets').delete(id); tx.objectStore('workspaces').delete(id);
    const last = tx.objectStore('meta').get('lastDataset'); last.onsuccess = () => { if (last.result === id) tx.objectStore('meta').delete('lastDataset'); };
  }); }
  close() { this.db?.close(); this.db = null; }
}
