# Architecture

## Data flow

The main thread owns the view, selected event, notes, and DOM. A dedicated Web Worker owns its copy of the normalized event dataset and a cached lowercase text index.

1. A file is read as text and sent to the worker.
2. The worker validates records, normalizes aliases, sorts timestamps, counts services/severities, and computes a content digest.
3. The main thread receives the dataset, activates the investigation, and saves it atomically with its workspace in IndexedDB.
4. Each filter request sends only view parameters and bookmark IDs to the worker.
5. The worker returns a transferable Uint32Array of matching indices and 80 histogram bins.
6. The virtual list renders the viewport plus five rows of overscan on each side. Each row is 64 pixels high.

The full event array exists in both the main thread and worker. This simplifies indexed detail lookup and rendering at the cost of memory. Import and activation use structured cloning; neither is zero-copy. Subsequent index responses transfer their ArrayBuffer.

## State and race handling

View state contains the search query, selected services/severities, time window, replay cursor, selected event, bookmark-only flag, and replay speed. All externally restored views pass through sanitization.

Worker requests carry monotonically increasing IDs. A latest-request guard discards obsolete filter results. Only one filter request is in flight from the UI loop; changes during that request schedule the latest state for the next scan.

The replay clock uses elapsed performance.now time and updates the view five times per second. It pauses when the tab becomes hidden. Pausing commits the replay position into a bounded, 60-entry undo history. Scrubbing commits when the slider change completes. Ordinary explicit view changes create browser history entries; playback replaces the current URL rather than adding hundreds of entries.

Dataset switches stop playback and flush pending saves. Save requests capture the dataset and workspace before joining a serialized promise chain. A later dataset switch cannot redirect an older note save to the wrong investigation. IndexedDB saveDataset writes the dataset, workspace, and last-opened pointer in one transaction.

Notes debounce for 350 milliseconds and flush on blur or tab hiding. Closing while a save remains pending can trigger the browser’s unsaved-work prompt. Browser termination can still interrupt work; exports remain the portable recovery mechanism.

## Offline model

There are two stores with different responsibilities:

| Store | Data |
| --- | --- |
| Cache API | HTML, CSS, JavaScript, manifest, SVG icon, and sample dataset |
| IndexedDB | Imported event arrays, notes, bookmarks, and saved views |

The Service Worker precaches an explicit asset list during installation. If that installation fails, it does not replace a working offline shell. Only same-origin GET requests inside its scope are eligible. Navigation uses the cached index document; known assets use the current cache with network fallback. Other requests pass through.

Cache names include the deployment scope, preventing one subdirectory deployment from deleting another’s cache. Activation removes only older caches for that scope. Updates do not forcibly replace an active worker; users close existing tabs to adopt a new version consistently.

There is no synchronization queue because this application has no remote write service. “Offline-first” here means that the application and investigation workflow can operate locally after initial caching.

## Rendering and accessibility

User data is inserted through textContent or text nodes. Event IDs are mapped to numeric row DOM IDs rather than used as HTML. Metadata is displayed as escaped text.

The list root retains keyboard focus while visible rows are replaced. It exposes listbox/option roles, selected state, aria-posinset, aria-setsize, and an active descendant when the selected row is rendered. Native dialog elements provide modal focus behavior. Severity is represented through text as well as color. The histogram’s accessible label describes its window/cursor; the event list exposes the underlying evidence.

The layout preserves service/severity filters on narrow screens and places the details panel below the list. Browser screenshots and assistive-technology audits were not available during the initial build; run the included browser suite and perform a manual keyboard/screen-reader review before claiming accessibility conformance.

## Honest performance boundaries

Filtering scans all events in the worker: O(n). A worker moves work off the UI thread; it does not make that algorithm asymptotically faster. DOM virtualization reduces mounted rows to O(viewport height / row height), independent of the total event count.

The 100,000-record Node test verifies correctness at the configured record limit. It is not a browser frame-rate benchmark. Device memory, metadata size, query complexity, worker cloning, and browser storage behavior all influence real performance.

Possible future improvements include incremental JSONL parsing, inverted search indexes, grouped trace exploration, richer aggregate metrics, and conflict-aware collaboration backed by a real sync service. These are not part of the implemented feature set.
