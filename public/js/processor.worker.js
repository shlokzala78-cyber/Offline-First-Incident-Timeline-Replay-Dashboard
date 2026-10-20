import { parseLogText, queryEvents, makeSearchIndex } from './core.js';
let dataset = null, searchIndex = [];
// Parsing and scans stay off the UI thread; only matching indices return on queries.
self.addEventListener('message', async ({ data: { id, type, payload } }) => {
  try {
    let result;
    if (type === 'parse') {
      result = await parseLogText(payload.text, payload.name);
      dataset = result.dataset; searchIndex = makeSearchIndex(dataset.events);
    } else if (type === 'load') {
      dataset = payload; searchIndex = makeSearchIndex(dataset.events); result = true;
    } else if (type === 'query') {
      if (!dataset) throw new Error('No incident has been loaded.');
      result = queryEvents(dataset, payload.view, payload.bookmarks, searchIndex);
      self.postMessage({ id, result }, [result.indices.buffer]); return;
    } else throw new Error('Unknown background operation.');
    self.postMessage({ id, result });
  } catch (error) { self.postMessage({ id, error: error.message }); }
});
