import { LEVELS, MAX_BYTES, defaultView, sanitizeView, exportWorkspace } from './core.js';
import { Repository } from './db.js';
import { Processor } from './processor.js';
import { ViewHistory } from './history.js';
import { encodeView, decodeView } from './view-state.js';
import { VirtualList } from './virtual-list.js';
import { $, el, time, duration, levelBadge, drawHistogram, toast, banner, announce, openDialog, closeDialog } from './components.js';

const repository = new Repository(), processor = new Processor();
const persisted = new Set(), eventMap = new Map();
let dataset, workspace, view, history, busy = false, selectedFile;
let saveTimer, saveChain = Promise.resolve(), revision = 0, savedRevision = 0;
let queryRevision = 0, queryRunning = false, queryAgain = false;
let playing = false, replayTimer, previousTick = 0, searchTimer;
let sampleId = '', pendingLink = decodeView(location.hash);
const list = new VirtualList(id => changeView({ selectedId: id }, { query: false }));
const number = value => value.toLocaleString();
const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('traceback-workspace') : null;

function report(error) {
  console.error(error);
  banner(error.message || 'Something went wrong. Export your investigation and reload to try again.');
}
function setBusy(value) {
  busy = value;
  for (const id of ['import-button', 'dataset-select', 'load-demo-button', 'confirm-delete']) $(id).disabled = value;
  $('confirm-import').disabled = value || !selectedFile;
  $('confirm-import').textContent = value ? 'Processing…' : 'Import file';
  $('main').setAttribute('aria-busy', String(value));
}
function writeURL(mode = 'replace') {
  if (!dataset || pendingLink) return;
  const url = location.pathname + location.search + encodeView(dataset.id, view);
  if (location.hash !== encodeView(dataset.id, view)) window.history[mode + 'State'](null, '', url);
}
function markDirty() {
  revision++; $('save-status').textContent = 'Saving locally…';
  clearTimeout(saveTimer); saveTimer = setTimeout(() => persist(), 350);
}
function persist() {
  clearTimeout(saveTimer);
  if (!dataset) return saveChain;
  // Snapshot before queuing: switching investigations must never redirect an old save.
  const data = dataset, state = structuredClone({ ...workspace, view }), version = revision;
  saveChain = saveChain.then(async () => {
    if (persisted.has(data.id)) await repository.saveWorkspace(data.id, state);
    else { await repository.saveDataset(data, state); persisted.add(data.id); }
    if (dataset?.id === data.id && revision === version) {
      savedRevision = version; $('save-status').textContent = 'Saved on this device';
      $('note-status').textContent = 'Notes are included in investigation exports.';
    }
    channel?.postMessage({ id: data.id });
  }).catch(error => {
    $('save-status').textContent = 'Not saved — export a copy';
    $('note-status').textContent = 'Local save failed. Export to keep your notes.';
    report(new Error('Local storage could not save this investigation. Export a copy before closing the tab. ' + error.message));
  });
  return saveChain;
}
function updateControls() {
  if (!dataset) return;
  $('search-input').value = view.query;
  $('replay-slider').value = String(view.to === view.from ? 1000 : Math.round((view.cursor - view.from) / (view.to - view.from) * 1000));
  $('replay-slider').setAttribute('aria-valuetext', new Date(view.cursor).toISOString());
  $('cursor-time').textContent = time(view.cursor);
  $('replay-speed').value = String(view.speed);
  $('play-icon').textContent = playing ? 'Ⅱ' : '▶';
  $('play-label').textContent = playing ? 'Pause' : 'Replay';
  $('play-button').setAttribute('aria-label', playing ? 'Pause incident replay' : 'Play incident replay');
  $('play-button').setAttribute('aria-pressed', String(playing));
  $('undo-button').disabled = !history.canUndo;
  $('redo-button').disabled = !history.canRedo;
  for (const id of ['export-button', 'share-button', 'play-button', 'replay-slider']) $(id).disabled = false;
  for (const [id, active] of [['all-events-button', !view.bookmarksOnly], ['bookmarks-button', view.bookmarksOnly]]) {
    $(id).classList.toggle('active', active); $(id).setAttribute('aria-pressed', String(active));
  }
  $('bookmark-count').textContent = number(workspace.bookmarks.length);
  for (const input of $('service-filters').querySelectorAll('input')) input.checked = view.services.includes(input.value);
  for (const chip of $('severity-filters').children) chip.setAttribute('aria-pressed', String(view.levels.includes(chip.dataset.level)));
  $('filter-summary').textContent = (view.services.length ? view.services.join(', ') : 'All services') + ' · ' + (view.levels.length ? view.levels.join(', ') : 'All severities') + (view.bookmarksOnly ? ' · Bookmarks' : '');
}
function renderDetails() {
  const event = eventMap.get(view.selectedId), content = $('details-content');
  $('notes-area').hidden = !event; $('bookmark-event').disabled = !event;
  if (!event) {
    const placeholder = el('div', 'detail-placeholder');
    placeholder.append(el('div', 'placeholder-symbol', '↖'), el('h3', '', 'Every event has a story.'), el('p', '', 'Select an event to inspect its message, metadata, and trace.'));
    content.replaceChildren(placeholder); return;
  }
  const marked = workspace.bookmarks.includes(event.id);
  $('bookmark-event').textContent = marked ? '★' : '☆';
  $('bookmark-event').setAttribute('aria-label', marked ? 'Remove bookmark from selected event' : 'Bookmark selected event');
  $('bookmark-event').setAttribute('aria-pressed', String(marked));
  const fields = el('dl', 'detail-fields');
  const field = (name, value) => { const dd = el('dd'); dd.append(typeof value === 'string' ? document.createTextNode(value) : value); fields.append(el('dt', '', name), dd); };
  field('Time', new Date(event.ts).toISOString().replace('T', ' ').replace('Z', ' UTC'));
  field('Service', event.service); field('Event ID', el('code', '', event.id));
  if (event.durationMs !== null) field('Duration', duration(event.durationMs));
  if (event.traceId) {
    const button = el('button', 'text-button', event.traceId);
    button.title = 'Search this trace ID'; button.addEventListener('click', () => changeView({ query: event.traceId, cursor: view.to }));
    field('Trace ID', button);
  }
  content.replaceChildren(levelBadge(event.level), el('p', 'detail-message', event.message), fields, el('h3', 'metadata-title', 'METADATA'), el('pre', 'metadata', JSON.stringify(event.metadata, null, 2)));
  const note = Object.hasOwn(workspace.notes, event.id) ? workspace.notes[event.id] : '';
  if ($('event-note').value !== note) $('event-note').value = note;
}
function renderDataset() {
  $('incident-title').textContent = dataset.title;
  document.title = dataset.title + ' — Traceback';
  $('incident-subtitle').textContent = new Date(dataset.start).toISOString().slice(0, 10) + ' · ' + time(dataset.start) + '–' + time(dataset.end) + ' UTC · Stored on this device';
  $('dataset-tag').textContent = dataset.id === sampleId || dataset.title === 'Checkout latency spike' ? 'SAMPLE DATA' : 'IMPORTED LOGS';
  const errors = dataset.counts.error + dataset.counts.critical;
  $('stat-events').textContent = number(dataset.count); $('nav-event-count').textContent = number(dataset.count);
  $('stat-errors').textContent = number(errors); $('stat-error-rate').textContent = (errors / dataset.count * 100).toFixed(1) + '% of all events';
  $('stat-services').textContent = dataset.services.length;
  $('stat-duration').textContent = duration(dataset.end - dataset.start);
  $('stat-window').textContent = 'All times shown in UTC';
  $('service-filters').replaceChildren(...dataset.services.map(service => {
    const label = el('label', 'service-row'), input = el('input');
    input.type = 'checkbox'; input.value = service.name;
    input.addEventListener('change', () => changeView({ services: [...$('service-filters').querySelectorAll('input:checked')].map(input => input.value) }));
    label.append(input, el('span', 'service-name', service.name), el('span', 'service-count', number(service.count)));
    return label;
  }));
  $('severity-filters').replaceChildren(...LEVELS.map(level => {
    const button = el('button', 'severity-chip'); button.dataset.level = level;
    button.append(el('i', 'dot ' + level), document.createTextNode(level[0].toUpperCase() + level.slice(1)));
    button.addEventListener('click', () => changeView({ levels: view.levels.includes(level) ? view.levels.filter(item => item !== level) : [...view.levels, level] }));
    return button;
  }));
}
async function refreshDatasets() {
  let items = [];
  try { items = await repository.list(); } catch { /* Memory-only mode still exposes the active investigation. */ }
  if (dataset && !items.some(item => item.id === dataset.id)) items.unshift(dataset);
  $('dataset-select').replaceChildren(...items.map(item => { const option = el('option', '', item.title); option.value = item.id; return option; }));
  if (dataset) $('dataset-select').value = dataset.id;
}
async function activate(data, state = {}, requestedView, loaded = false) {
  pauseReplay(false); queryRevision++;
  await processor.request('load', data);
  dataset = data; workspace = { notes: state.notes ?? {}, bookmarks: state.bookmarks ?? [] };
  eventMap.clear(); for (const event of dataset.events) eventMap.set(event.id, event);
  view = sanitizeView(requestedView ?? state.view, dataset); history = new ViewHistory(view);
  if (loaded) persisted.add(dataset.id);
  else persisted.delete(dataset.id);
  revision++; savedRevision = loaded ? revision : -1;
  list.root.scrollTop = 0;
  renderDataset(); updateControls(); renderDetails(); writeURL();
  await runQuery(); markDirty(); await persist(); await refreshDatasets();
  announce('Loaded ' + dataset.title + ', ' + number(dataset.count) + ' events.');
}
async function runQuery() {
  queryRevision++; queryAgain = true;
  if (queryRunning || !dataset) return;
  queryRunning = true;
  try {
    while (queryAgain) {
      queryAgain = false;
      const version = queryRevision, id = dataset.id;
      const result = await processor.request('query', { view: structuredClone(view), bookmarks: [...workspace.bookmarks] });
      // Discard results for stale filters or a different investigation.
      if (version !== queryRevision || dataset?.id !== id) continue;
      list.setData(dataset.events, result.indices, view.selectedId, workspace.bookmarks);
      $('event-count').textContent = number(result.indices.length);
      $('event-list').hidden = !result.indices.length;
      $('empty-state').hidden = !!result.indices.length;
      $('stream-summary').textContent = number(result.indices.length) + ' revealed / ' + number(result.matching) + ' matching · ' + number(result.errorCount) + ' errors in window';
      drawHistogram(result.bins, view);
    }
  } catch (error) { pauseReplay(false); report(error); }
  finally { queryRunning = false; }
}
function pauseReplay(commit = true) {
  if (!playing) return;
  playing = false; clearInterval(replayTimer);
  if (commit && dataset) { history.commit(view); writeURL(); markDirty(); }
  if (dataset) updateControls();
}
function changeView(patch, options = {}) {
  if (!dataset || busy) return;
  pauseReplay(); clearTimeout(searchTimer);
  view = sanitizeView({ ...view, ...patch }, dataset);
  history.commit(view); pendingLink = null;
  writeURL('push'); updateControls(); renderDetails(); markDirty();
  if (options.query !== false) { if (patch.cursor === undefined) list.root.scrollTop = 0; runQuery(); }
  else { list.selectedId = view.selectedId; list.render(); }
}
function toggleReplay() {
  if (!dataset || busy) return;
  if (playing) { pauseReplay(); return; }
  if (view.cursor >= view.to) view = { ...view, cursor: view.from };
  if (view.to === view.from) { toast('This incident contains a single timestamp.'); return; }
  playing = true; previousTick = performance.now(); updateControls(); runQuery();
  replayTimer = setInterval(() => {
    const now = performance.now(), delta = now - previousTick; previousTick = now;
    view = { ...view, cursor: Math.min(view.to, view.cursor + delta * view.speed) };
    updateControls(); writeURL(); runQuery();
    if (view.cursor >= view.to) { pauseReplay(); announce('Replay complete.'); }
  }, 200);
}
function resetView() { if (dataset) changeView({ ...defaultView(dataset), selectedId: view.selectedId }); }
function travel(direction) {
  if (!dataset || busy) return;
  pauseReplay();
  const next = history[direction](); if (!next) return;
  view = next; pendingLink = null; writeURL('push'); updateControls(); renderDetails(); runQuery(); markDirty();
}
function toggleBookmark() {
  if (!dataset || !view.selectedId || busy) return;
  const id = view.selectedId, marked = workspace.bookmarks.includes(id);
  workspace.bookmarks = marked ? workspace.bookmarks.filter(item => item !== id) : [...workspace.bookmarks, id];
  updateControls(); renderDetails(); runQuery(); markDirty(); announce(marked ? 'Bookmark removed.' : 'Event bookmarked.');
}
async function loadSample() {
  const response = await fetch(new URL('../data/sample-incident.json', import.meta.url));
  if (!response.ok) throw new Error('Could not load the sample incident. Try refreshing while connected.');
  const result = await processor.request('parse', { text: await response.text(), name: 'Sample incident' });
  sampleId = result.dataset.id;
  let existing;
  try { existing = await repository.get(sampleId); } catch { /* Saving remains optional if browser storage is unavailable. */ }
  const requested = pendingLink?.datasetId === sampleId ? pendingLink.view : undefined;
  if (requested) { pendingLink = null; banner(); }
  await activate(result.dataset, existing?.workspace ?? result.workspace, requested, !!existing?.dataset);
}
function chooseFile(file) {
  selectedFile = file;
  $('import-file-name').textContent = file ? file.name + ' · ' + (file.size / 1024).toFixed(1) + ' KiB' : 'No file selected';
  $('import-error').textContent = file?.size > MAX_BYTES ? 'This file exceeds the 20 MiB import limit.' : '';
  $('confirm-import').disabled = !file || file.size > MAX_BYTES || busy;
}
async function importFile() {
  if (!selectedFile || busy) return;
  setBusy(true); pauseReplay(); await persist();
  try {
    if (selectedFile.size > MAX_BYTES) throw new Error('This file exceeds the 20 MiB import limit.');
    const result = await processor.request('parse', { text: await selectedFile.text(), name: selectedFile.name });
    const requested = pendingLink?.datasetId === result.dataset.id ? pendingLink.view : undefined;
    if (requested) pendingLink = null;
    else if (pendingLink) toast('Imported a different incident. The linked incident is still missing.');
    else banner();
    await activate(result.dataset, result.workspace, requested);
    closeDialog('import-dialog'); chooseFile(null); $('file-input').value = '';
    toast('Imported ' + number(dataset.count) + ' events.');
  } catch (error) { $('import-error').textContent = error.message; }
  finally { setBusy(false); }
}
function exportIncident() {
  if (!dataset) return;
  const blob = new Blob([JSON.stringify(exportWorkspace(dataset, workspace, view), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob), link = el('a');
  link.href = url; link.download = dataset.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60) + '-investigation.json';
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Export includes logs, notes, bookmarks, and the current view.');
}
async function handleHash() {
  const decoded = decodeView(location.hash);
  if (!decoded || !dataset || busy) return;
  pauseReplay();
  if (decoded.datasetId === dataset.id) {
    pendingLink = null; view = sanitizeView(decoded.view, dataset); history.commit(view);
    updateControls(); renderDetails(); runQuery(); markDirty(); return;
  }
  setBusy(true);
  try {
    await persist(); const saved = await repository.get(decoded.datasetId);
    if (saved.dataset) { pendingLink = null; banner(); await activate(saved.dataset, saved.workspace, decoded.view, true); }
    else { pendingLink = decoded; banner('This view links to an incident that is not on this device. Import its JSON logs or investigation export to open it.'); }
  } catch (error) { report(error); }
  finally { setBusy(false); }
}

$('import-button').addEventListener('click', () => { pauseReplay(); openDialog('import-dialog'); });
$('help-button').addEventListener('click', () => openDialog('help-dialog'));
for (const button of document.querySelectorAll('[data-close]')) button.addEventListener('click', () => closeDialog(button.dataset.close));
$('file-input').addEventListener('change', event => chooseFile(event.target.files[0]));
$('import-form').addEventListener('submit', event => { event.preventDefault(); importFile(); });
for (const name of ['dragenter', 'dragover']) $('dropzone').addEventListener(name, event => { event.preventDefault(); $('dropzone').classList.add('dragging'); });
for (const name of ['dragleave', 'drop']) $('dropzone').addEventListener(name, event => { event.preventDefault(); $('dropzone').classList.remove('dragging'); if (name === 'drop') chooseFile(event.dataTransfer.files[0]); });
document.addEventListener('dragover', event => event.preventDefault());
document.addEventListener('drop', event => event.preventDefault());
$('load-demo-button').addEventListener('click', async () => {
  if (busy) return; setBusy(true); pauseReplay(); await persist();
  try { pendingLink = null; banner(); await loadSample(); closeDialog('import-dialog'); }
  catch (error) { $('import-error').textContent = error.message; }
  finally { setBusy(false); }
});
$('dataset-select').addEventListener('change', async event => {
  if (busy) return; const id = event.target.value; setBusy(true); pauseReplay(); await persist();
  try {
    const saved = await repository.get(id);
    if (!saved.dataset) throw new Error('This investigation is no longer in local storage.');
    pendingLink = null; banner(); await activate(saved.dataset, saved.workspace, undefined, true);
  } catch (error) { report(error); await refreshDatasets(); }
  finally { setBusy(false); }
});
$('search-input').addEventListener('input', event => {
  clearTimeout(searchTimer); const query = event.target.value;
  searchTimer = setTimeout(() => changeView({ query }), 180);
});
$('search-input').addEventListener('focus', () => pauseReplay());
$('all-events-button').addEventListener('click', () => changeView({ bookmarksOnly: false }));
$('bookmarks-button').addEventListener('click', () => changeView({ bookmarksOnly: true }));
$('clear-services').addEventListener('click', () => changeView({ services: [] }));
for (const id of ['reset-filters', 'empty-reset']) $(id).addEventListener('click', resetView);
$('undo-button').addEventListener('click', () => travel('undo'));
$('redo-button').addEventListener('click', () => travel('redo'));
$('bookmark-event').addEventListener('click', toggleBookmark);
$('event-note').addEventListener('input', event => {
  if (!view?.selectedId || busy) return;
  workspace.notes = { ...workspace.notes, [view.selectedId]: event.target.value };
  $('note-status').textContent = 'Saving note…'; markDirty();
});
$('event-note').addEventListener('blur', () => { if (revision !== savedRevision) persist(); });
$('export-button').addEventListener('click', exportIncident);
$('play-button').addEventListener('click', toggleReplay);
$('replay-start').addEventListener('click', () => { if (view) changeView({ cursor: view.from }); });
$('show-all-button').addEventListener('click', () => { if (view) changeView({ cursor: view.to }); });
$('replay-speed').addEventListener('change', event => changeView({ speed: Number(event.target.value) }));
$('replay-slider').addEventListener('input', event => {
  if (!view || busy) return;
  pauseReplay(); view = { ...view, cursor: view.from + Number(event.target.value) / 1000 * (view.to - view.from) };
  updateControls(); writeURL(); runQuery();
});
$('replay-slider').addEventListener('change', () => { if (view) { history.commit(view); markDirty(); updateControls(); } });
$('replay-next').addEventListener('click', async () => {
  if (!dataset || busy) return; pauseReplay();
  const id = dataset.id, snapshot = JSON.stringify(view);
  try {
    const result = await processor.request('query', { view: { ...view, cursor: view.to }, bookmarks: workspace.bookmarks });
    if (dataset.id !== id || JSON.stringify(view) !== snapshot) return;
    const index = result.indices.find(index => dataset.events[index].ts > view.cursor);
    if (index !== undefined) changeView({ cursor: dataset.events[index].ts, selectedId: dataset.events[index].id });
    else toast('No later event matches these filters.');
  } catch (error) { report(error); }
});
$('time-range-button').addEventListener('click', () => {
  if (!view) return; pauseReplay();
  $('range-from').value = new Date(view.from).toISOString().slice(0, -1);
  $('range-to').value = new Date(view.to).toISOString().slice(0, -1);
  $('range-error').textContent = ''; openDialog('range-dialog');
});
$('range-form').addEventListener('submit', event => {
  event.preventDefault();
  const from = Date.parse($('range-from').value + 'Z'), to = Date.parse($('range-to').value + 'Z');
  if (!Number.isFinite(from) || !Number.isFinite(to) || from > to || from < dataset.start || to > dataset.end) {
    $('range-error').textContent = 'Choose an ordered range inside ' + new Date(dataset.start).toISOString() + ' to ' + new Date(dataset.end).toISOString() + '.'; return;
  }
  changeView({ from, to, cursor: to }); closeDialog('range-dialog');
});
$('full-range-button').addEventListener('click', () => { changeView({ from: dataset.start, to: dataset.end, cursor: dataset.end }); closeDialog('range-dialog'); });
$('share-button').addEventListener('click', async () => {
  if (!dataset) return;
  const url = new URL(location.href); url.hash = encodeView(dataset.id, view);
  try { await navigator.clipboard.writeText(url.href); toast('View link copied. Recipients also need this incident’s exported JSON.'); }
  catch { toast('Clipboard unavailable. Copy the address bar URL after selecting this view.'); }
});
$('delete-button').addEventListener('click', () => { if (dataset && !busy) { pauseReplay(); openDialog('delete-dialog'); } });
$('confirm-delete').addEventListener('click', async () => {
  if (!dataset || busy) return; setBusy(true); await persist();
  try {
    await repository.remove(dataset.id); persisted.delete(dataset.id);
    dataset = null; pendingLink = null; revision = savedRevision = 0;
    window.history.replaceState(null, '', location.pathname + location.search);
    const remaining = await repository.list();
    if (remaining.length) { const saved = await repository.get(remaining[0].id); await activate(saved.dataset, saved.workspace, undefined, true); }
    else await loadSample();
    closeDialog('delete-dialog'); toast('Deleted locally. A sample opens when no investigations remain.');
  } catch (error) { report(error); }
  finally { setBusy(false); }
});
document.addEventListener('keydown', event => {
  if (document.querySelector('dialog[open]') || event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); travel(event.shiftKey ? 'redo' : 'undo'); }
  else if (event.ctrlKey || event.metaKey || event.altKey) return;
  else if (event.key === '/') { event.preventDefault(); $('search-input').focus(); }
  else if (event.key === '?' ) { event.preventDefault(); openDialog('help-dialog'); }
  else if (event.key === ' ' && !event.target.closest('button, a')) { event.preventDefault(); toggleReplay(); }
  else if (event.key.toLowerCase() === 'b') { event.preventDefault(); toggleBookmark(); }
});
window.addEventListener('hashchange', handleHash);
window.addEventListener('popstate', handleHash);
document.addEventListener('visibilitychange', () => { if (document.hidden) { pauseReplay(); if (revision !== savedRevision) persist(); } });
window.addEventListener('beforeunload', event => {
  if (dataset && revision !== savedRevision) { event.preventDefault(); event.returnValue = ''; }
});
if (channel) channel.onmessage = event => {
  if (event.data?.id === dataset?.id) banner('Another Traceback tab saved this investigation. Export any unsaved work before reloading. Concurrent edits use the last saved version.');
};
function connection() {
  const online = navigator.onLine;
  $('connection-status').classList.toggle('offline', !online);
  $('connection-status').replaceChildren(el('span', 'status-dot'), document.createTextNode(online ? 'Online' : 'Offline'));
}
window.addEventListener('online', connection); window.addEventListener('offline', connection); connection();
$('persist-button').addEventListener('click', async () => {
  try {
    const granted = await navigator.storage?.persist?.();
    toast(granted ? 'Persistent storage granted. Keep exports as a backup.' : 'The browser did not grant persistent storage. Export important investigations.');
  } catch { toast('Persistent storage is unavailable here. Export important investigations.'); }
});
async function prepareOffline() {
  if (!('serviceWorker' in navigator)) { $('offline-description').textContent = 'Offline caching is unavailable in this browser. Local data still uses IndexedDB.'; return; }
  try {
    const registration = await navigator.serviceWorker.register(new URL('../sw.js', import.meta.url), { scope: new URL('../', import.meta.url).pathname });
    await navigator.serviceWorker.ready;
    $('offline-description').textContent = 'App cached for offline use. Logs and notes stay on this device.';
    if (registration.waiting) toast('An app update is ready. Close all Traceback tabs and reopen to apply it.');
    registration.addEventListener('updatefound', () => {
      registration.installing?.addEventListener('statechange', event => {
        if (event.target.state === 'installed' && navigator.serviceWorker.controller) toast('Update downloaded. Close all Traceback tabs to apply it.');
      });
    });
  } catch {
    $('offline-description').textContent = 'Offline cache could not be prepared. Run on localhost or HTTPS and reload while connected.';
  }
}
async function start() {
  setBusy(true); prepareOffline();
  try {
    let saved;
    try {
      const id = pendingLink?.datasetId ?? await repository.last();
      if (id) saved = await repository.get(id);
    } catch (error) { report(error); }
    if (saved?.dataset) {
      const requested = pendingLink?.view; pendingLink = null;
      await activate(saved.dataset, saved.workspace, requested, true);
    } else {
      await loadSample();
      if (pendingLink) banner('This view refers to an incident not saved on this device. Import its logs or investigation export. The sample is shown until then.');
    }
  } catch (error) {
    $('incident-title').textContent = 'Open an investigation';
    $('incident-subtitle').textContent = 'Import a JSON or JSONL log file to begin.';
    $('save-status').textContent = 'No investigation loaded'; report(error);
  } finally { setBusy(false); }
}
start();
