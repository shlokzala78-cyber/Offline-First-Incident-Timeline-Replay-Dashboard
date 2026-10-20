export function encodeView(datasetId, view) {
  const params = new URLSearchParams({ v: '1', dataset: datasetId });
  for (const key of ['query', 'from', 'to', 'cursor', 'selectedId', 'speed']) if (view[key] !== '' && view[key] !== undefined) params.set(key, String(view[key]));
  if (view.services.length) params.set('services', JSON.stringify(view.services));
  if (view.levels.length) params.set('levels', JSON.stringify(view.levels));
  if (view.bookmarksOnly) params.set('bookmarks', '1');
  return `#${params}`;
}
export function decodeView(hash) {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  if (params.get('v') !== '1' || !/^[a-f0-9]{24}$/.test(params.get('dataset') ?? '')) return null;
  const array = key => { try { const value = JSON.parse(params.get(key) ?? '[]'); return Array.isArray(value) ? value.filter(x => typeof x === 'string') : []; } catch { return []; } };
  const view = { services: array('services'), levels: array('levels'), query: params.get('query') ?? '', selectedId: params.get('selectedId') ?? '', bookmarksOnly: params.get('bookmarks') === '1' };
  for (const key of ['from', 'to', 'cursor', 'speed']) if (params.has(key)) { const n = Number(params.get(key)); if (Number.isFinite(n)) view[key] = n; }
  return { datasetId: params.get('dataset'), view };
}
