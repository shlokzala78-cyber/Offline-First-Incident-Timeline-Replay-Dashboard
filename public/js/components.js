export const $ = id => document.getElementById(id);
export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
export function time(ms, milliseconds = false) {
  return new Date(ms).toISOString().slice(11, milliseconds ? 23 : 19);
}
export function duration(ms) {
  if (ms < 1000) return Math.round(ms) + ' ms';
  if (ms < 60000) return (ms / 1000).toFixed(1) + ' sec';
  if (ms < 3600000) return (ms / 60000).toFixed(1) + ' min';
  return (ms / 3600000).toFixed(1) + ' hr';
}
export function levelBadge(level) { return el('span', 'level-label ' + level, level.toUpperCase()); }
let toastTimer;
export function toast(message) {
  $('toast').textContent = message; $('toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4500);
}
export function banner(message = '') { $('banner').textContent = message; $('banner').hidden = !message; }
export function announce(message) { $('announcer').textContent = message; }
export function openDialog(id) { $(id).showModal(); }
export function closeDialog(id) { $(id).close(); }
export function drawHistogram(bins, view) {
  const svg = $('histogram'), ns = 'http://www.w3.org/2000/svg';
  const make = (tag, attrs) => {
    const node = document.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    return node;
  };
  const fragment = document.createDocumentFragment();
  for (const y of [25, 65, 105, 136]) fragment.append(make('line', { x1: 0, y1: y, x2: 1000, y2: y, stroke: '#edf0f6', 'stroke-width': 1 }));
  const max = Math.max(1, ...bins.map(bin => bin.info + bin.warn + bin.error));
  const span = Math.max(1, view.to - view.from);
  const fraction = Math.max(0, Math.min(1, (view.cursor - view.from) / span));
  const colors = { info: '#9a90ed', warn: '#ecb45b', error: '#e77a8e' };
  bins.forEach((bin, index) => {
    let y = 136;
    for (const group of ['info', 'warn', 'error']) {
      if (!bin[group]) continue;
      const height = bin[group] / max * 113;
      y -= height;
      const rect = make('rect', { x: index * 12.5 + 2, y, width: 8.5, height, rx: 1.5, fill: colors[group], opacity: index / 80 <= fraction ? 1 : .22 });
      const title = make('title', {});
      title.textContent = time(view.from + index / 80 * span) + ' UTC: ' + bin[group] + ' ' + group + ' events';
      rect.append(title); fragment.append(rect);
    }
  });
  if (view.cursor < view.to) {
    fragment.append(make('line', { x1: fraction * 1000, y1: 8, x2: fraction * 1000, y2: 140, stroke: '#6558e8', 'stroke-width': 2, 'stroke-dasharray': '4 3' }));
    fragment.append(make('circle', { cx: fraction * 1000, cy: 8, r: 4, fill: '#6558e8' }));
  }
  svg.replaceChildren(fragment);
  svg.setAttribute('aria-label', 'Event volume across the selected time range. Replay cursor: ' + time(view.cursor) + ' UTC. Use the replay slider to move through time.');
  $('chart-ticks').replaceChildren(...[0, .25, .5, .75, 1].map(n => el('span', '', time(view.from + (view.to - view.from) * n))));
  $('chart-empty').hidden = bins.some(bin => bin.info + bin.warn + bin.error > 0);
}
