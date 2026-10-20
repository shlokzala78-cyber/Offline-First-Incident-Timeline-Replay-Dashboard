import { virtualWindow } from './core.js';
import { $, el, time, levelBadge } from './components.js';

export class VirtualList {
  constructor(onSelect) {
    this.root = $('event-list'); this.rows = $('event-rows'); this.indices = new Uint32Array();
    this.events = []; this.selectedId = ''; this.bookmarks = new Set(); this.onSelect = onSelect;
    this.root.addEventListener('scroll', () => {
      if (!this.frame) this.frame = requestAnimationFrame(() => { this.frame = 0; this.render(); });
    });
    this.rows.addEventListener('click', event => {
      const row = event.target.closest('[data-position]');
      if (row) { this.root.focus({ preventScroll: true }); this.select(Number(row.dataset.position)); }
    });
    this.root.addEventListener('keydown', event => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter'].includes(event.key) || !this.indices.length) return;
      event.preventDefault();
      let position = this.indices.findIndex(index => this.events[index].id === this.selectedId);
      if (event.key === 'Home') position = 0;
      else if (event.key === 'End') position = this.indices.length - 1;
      else if (event.key === 'ArrowDown') position = Math.min(this.indices.length - 1, position + 1);
      else if (event.key === 'ArrowUp') position = Math.max(0, position - 1);
      else position = Math.max(0, position);
      this.select(position, true);
    });
    this.observer = new ResizeObserver(() => this.render());
    this.observer.observe(this.root);
  }
  setData(events, indices, selectedId, bookmarks) {
    this.events = events; this.indices = indices; this.selectedId = selectedId; this.bookmarks = new Set(bookmarks);
    $('event-spacer').style.height = indices.length * 64 + 'px';
    this.root.scrollTop = Math.min(this.root.scrollTop, Math.max(0, indices.length * 64 - this.root.clientHeight));
    this.render();
  }
  select(position, scroll = false) {
    const event = this.events[this.indices[position]];
    if (!event) return;
    this.selectedId = event.id;
    if (scroll) {
      const top = position * 64;
      if (top < this.root.scrollTop) this.root.scrollTop = top;
      if (top + 64 > this.root.scrollTop + this.root.clientHeight) this.root.scrollTop = top + 64 - this.root.clientHeight;
    }
    this.render(); this.onSelect(event.id);
  }
  render() {
    const window = virtualWindow(this.indices.length, this.root.scrollTop, this.root.clientHeight);
    const fragment = document.createDocumentFragment();
    this.root.removeAttribute('aria-activedescendant');
    for (let position = window.start; position < window.end; position++) {
      const index = this.indices[position], event = this.events[index];
      const row = el('div', 'event-row'); row.id = 'event-row-' + index; row.dataset.position = position;
      row.setAttribute('role', 'option'); row.setAttribute('aria-selected', String(event.id === this.selectedId));
      row.setAttribute('aria-posinset', String(position + 1)); row.setAttribute('aria-setsize', String(this.indices.length));
      const main = el('div', 'event-row-main'), heading = el('div', 'event-row-heading');
      heading.append(levelBadge(event.level), el('span', 'event-service', event.service));
      main.append(heading, el('div', 'event-row-message', event.message));
      const mark = el('span', 'row-bookmark', this.bookmarks.has(event.id) ? '★' : '');
      if (this.bookmarks.has(event.id)) mark.setAttribute('aria-label', 'Bookmarked');
      row.append(el('span', 'event-row-time', time(event.ts)), main, mark);
      fragment.append(row);
      if (event.id === this.selectedId) this.root.setAttribute('aria-activedescendant', row.id);
    }
    this.rows.style.transform = 'translateY(' + window.offset + 'px)';
    this.rows.replaceChildren(fragment);
  }
}
