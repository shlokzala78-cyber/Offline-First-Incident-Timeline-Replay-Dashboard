export class ViewHistory {
  #past = []; #future = [];
  constructor(initial, limit = 60) { this.current = structuredClone(initial); this.limit = limit; }
  commit(next) {
    if (JSON.stringify(next) === JSON.stringify(this.current)) return false;
    this.#past.push(structuredClone(this.current));
    if (this.#past.length > this.limit) this.#past.shift();
    this.current = structuredClone(next); this.#future = []; return true;
  }
  replace(next) { this.current = structuredClone(next); }
  undo() { if (!this.#past.length) return null; this.#future.push(this.current); this.current = this.#past.pop(); return structuredClone(this.current); }
  redo() { if (!this.#future.length) return null; this.#past.push(this.current); this.current = this.#future.pop(); return structuredClone(this.current); }
  get canUndo() { return this.#past.length > 0; }
  get canRedo() { return this.#future.length > 0; }
}
