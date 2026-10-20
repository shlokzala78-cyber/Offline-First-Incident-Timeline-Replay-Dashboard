export class Processor {
  constructor() {
    this.worker = new Worker(new URL('./processor.worker.js', import.meta.url), { type: 'module' });
    this.pending = new Map(); this.nextId = 0;
    this.worker.onmessage = ({ data }) => {
      const request = this.pending.get(data.id); if (!request) return;
      clearTimeout(request.timer); this.pending.delete(data.id);
      if (data.error) request.reject(new Error(data.error)); else request.resolve(data.result);
    };
    this.worker.onerror = () => this.fail(new Error('Background processing stopped. Reload the app to try again.'));
  }
  request(type, payload) {
    if (this.broken) return Promise.reject(new Error('Background processing is unavailable. Reload the app.'));
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => this.fail(new Error('Processing timed out. Reload and try a smaller file.')), 60000);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ id, type, payload });
    });
  }
  fail(error) { this.broken = true; this.worker.terminate(); for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error); } this.pending.clear(); }
}
