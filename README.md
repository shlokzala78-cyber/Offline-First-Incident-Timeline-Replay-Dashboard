# Traceback — Offline-First Incident Timeline & Replay Dashboard

A frontend investigation workspace that turns exported application logs into an interactive incident timeline. Import JSON or JSONL, replay events in order, filter across services, follow trace IDs, and preserve investigation notes when the network disappears.

Built with **HTML, CSS, and JavaScript**, using IndexedDB, a Service Worker, and a Web Worker. The browser application has no runtime framework, CDN, account, API key, or backend dependency. A small Node server serves the files during local development.

## Run in VS Code

1. Extract the ZIP. Open the **offline-incident-dashboard** folder in VS Code using **File → Open Folder**. This folder contains package.json and server.mjs.
2. Install Node.js if you do not already have it. The project requires Node **22 or newer**; Node **24** was used for the included verification. Restart VS Code after installing Node.
3. Select **Terminal → New Terminal** and run:

       node --version
       npm start

4. Open **http://localhost:4173** in Chrome or Edge. The sample incident loads automatically.

**npm install is not needed just to run the app.** The local server uses only built-in Node modules. Keep the terminal open; use Ctrl+C to stop it. Open the URL, rather than double-clicking index.html.

On Windows, if PowerShell says npm.ps1 cannot run, use:

    npm.cmd start

Alternatively, run the server directly:

    node server.mjs

The included VS Code launch configuration can start the server from **Run and Debug → Traceback server**. Start it only once to avoid a port conflict.

## Try the project

The sample contains **1,084 synthetic events across six services**, spanning approximately 24 minutes. It tells the story of a payment connection pool change, rising checkout latency, a mitigation, and recovery. All sample data is fictional.

1. Click **Replay** to watch the incident unfold; change the speed to 120× to move faster.
2. Select **payment-service** and **Error** to isolate a failing component.
3. Clear filters, search for **pool**, and inspect a result.
4. Click a trace ID in the details panel to search correlated events.
5. Bookmark an event and add an investigation note.
6. Reload after the save completes. The selected event, notes, bookmarks, filters, and replay position return.
7. Click **Export** to download a portable investigation containing the logs and your work.
8. Import **examples/mini-incident.jsonl** to try a small five-event incident.

The statistics show the **whole incident**. The histogram shows events matching the current service, severity, search, bookmark, and time-window filters. The event list reveals only matching events at or before the replay cursor. Future histogram bars are dimmed. Selected details remain open while you change the view.

## What is implemented

| Capability | What it lets a user do |
| --- | --- |
| JSON, JSONL, and investigation import | Bring exported logs into one investigation without uploading them to a server |
| Background parsing and filtering | Keep parsing and full event scans off the main UI thread |
| Virtualized event stream | Navigate large collections while rendering only visible rows plus overscan |
| Linked filters and search | Narrow by service, severity, time, bookmarks, message, event ID, trace, or metadata |
| Replay, scrubber, next event, speed control | Reconstruct the order of events and pause at meaningful points |
| Details, trace navigation, notes, bookmarks | Preserve evidence and investigative context |
| IndexedDB persistence | Recover investigations and view state after a reload |
| Service Worker app cache | Reload the application after its initial assets have been cached, even offline |
| Shareable view links | Reproduce filters, selected event, and replay position on a device with the same logs |
| Undo/redo and browser history | Revisit prior view changes |
| Keyboard support and native dialogs | Operate filters and event inspection without a mouse |
| Export and re-import | Move an investigation between browsers or share it as a file |

## Log format

Import a JSON array, newline-delimited JSON records, a single JSON record, or an object containing an events array.

    [
      {
        "id": "event-001",
        "timestamp": "2026-06-14T14:00:00.000Z",
        "service": "payment-service",
        "level": "error",
        "message": "Payment request timed out",
        "traceId": "trace-123",
        "durationMs": 2500,
        "metadata": {
          "status": 504,
          "region": "us-east-1"
        }
      }
    ]

Only timestamp is required. It accepts an ISO timestamp with timezone and seconds, or nonnegative epoch milliseconds. The alias ts is also accepted. All displayed times and time-window inputs are **UTC**.

| Field | Default or rule |
| --- | --- |
| id | Generated if omitted; must be unique within the file |
| timestamp / ts | Required; timezone required for strings; invalid calendar dates rejected |
| service | Defaults to unknown |
| level / severity | critical, error, warn, info, debug; defaults to info; warning and fatal aliases accepted |
| message | Defaults to “(no message)” |
| traceId / trace_id | Optional text |
| durationMs / duration_ms | Optional nonnegative duration |
| metadata | Optional JSON object |

Limits: **20 MiB per import, 100,000 events, 100 services, 8,000 characters per message, and 4,000 characters per note**. Import errors identify invalid records; duplicate IDs are rejected rather than silently overwritten. The input is normalized and sorted by timestamp, then event ID.

Investigations are identified by a SHA-256 digest of their normalized event content. Re-importing the same normalized content opens the same dataset identity and replaces its notes/bookmarks with the contents of that import. Export your current work before importing a different version of the same investigation. The sample loader preserves existing notes for the sample.

An export can be larger than its original logs because it includes normalized fields and notes. Split very large investigations if their exported files exceed the import limit.

## Demonstrate offline behavior

1. Start the app normally and wait for **“App cached for offline use”** in the desktop sidebar.
2. Make an investigation note and wait until the save completes.
3. In browser developer tools, open **Network** and select **Offline**.
4. Reload. The interface and stored investigation should load.
5. Filter, replay, add notes, and export while offline.
6. Restore the Network setting to **No throttling** afterward.

The cache must be populated once before an offline visit. Use **localhost or HTTPS**; file URLs do not provide this workflow. Cached files and IndexedDB are separate: the Service Worker stores the application shell, while IndexedDB stores investigations.

The browser may evict site data. “Keep data on this device” requests persistent storage, but the browser decides whether to grant it. Keep investigation exports as portable backups. Private browsing, clearing site data, changing browser profiles, or changing the site origin can remove or hide previously saved work.

## Sharing and privacy

**Copy view link** includes filters, time range, replay cursor, selected event, and dataset identity in the URL fragment. It does not upload or embed the logs. Recipients need the same investigation file and a reachable deployment of the application.

A localhost link points to each recipient’s own computer; use an HTTPS deployment for a public demo. Send the investigation export separately. The recipient imports it, then opens the view link. Missing datasets produce an import prompt while the sample remains available.

Search terms and IDs may be visible in copied URLs. Exports include the complete log data and notes. Review them before sharing. Imported messages and metadata are inserted as text, not interpreted as HTML.

There is no cloud sync or multi-user collaboration. Editing one investigation in multiple tabs uses the last saved state; a cross-tab notice warns when another tab saves. Export before merging work manually.

## Keyboard controls

| Key | Action |
| --- | --- |
| / | Focus event search |
| Space | Play/pause when focus is not on a form control or button |
| ↑ / ↓, Home / End | Navigate the focused event list |
| Enter | Inspect the focused list selection |
| B | Toggle a bookmark on the selected event |
| Ctrl/Command+Z | Undo a view change |
| Ctrl/Command+Shift+Z | Redo a view change |
| ? | Open keyboard help |
| Escape | Close the active dialog |

Text inputs keep their normal editing shortcuts. Undo/redo covers views; notes and bookmarks save independently. Native dialogs support focus containment and Escape. The virtual list exposes selection and item positions to assistive technology. Formal accessibility conformance has not been audited.

## Tests

Install development dependencies:

    npm ci

Check JavaScript syntax, HTML IDs referenced by modules, and the offline asset list:

    npm run check

Run unit and integration tests:

    npm test

The suite exercises normalization, invalid input, 100,000-event filtering, replay boundaries, export round trips, view history, URL encoding, virtual window calculations, IndexedDB reopen/rollback, static path restrictions, worker messaging, and Service Worker cache policy.

Run the included browser tests on your computer:

    npx playwright install chromium
    npm run test:browser

The browser suite starts the server automatically and covers desktop/mobile Chromium, filters, keyboard selection, notes, recovery, imports, exports, replay stepping, offline reload, invalid input, and safe text rendering. Use npm run test:browser:ui for interactive debugging.

**Verification at handoff:** 20 Node tests passed. Syntax, DOM-reference, and offline-asset checks passed. The 12 Playwright cases were discovered successfully but **were not executed** in the build environment. Browser layout, interactions, and offline reload still require that local or CI run. The cache tests use a mock Cache API and the storage tests use fake-indexeddb; they are not substitutes for real-browser testing.

The GitHub Actions workflow runs the checks, Node tests, and browser suite after you push.

## Project organization

| Path | Purpose |
| --- | --- |
| public/index.html | Semantic interface, controls, and dialogs |
| public/app.css | Responsive dashboard styling |
| public/js/app.js | UI state, interactions, saving, replay, and import/export |
| public/js/core.js | Pure parsing, normalization, filtering, and virtualization helpers |
| public/js/processor.js | Promise-based Web Worker request client |
| public/js/processor.worker.js | Background parse/search/filter operations |
| public/js/virtual-list.js | Viewport-based event row rendering and keyboard navigation |
| public/js/components.js | Shared DOM helpers and SVG histogram |
| public/js/db.js | IndexedDB repository and atomic transactions |
| public/js/history.js | Bounded undo/redo view history |
| public/js/view-state.js | URL view serialization and validation |
| public/sw.js | Versioned, scoped offline application cache |
| public/data/sample-incident.json | Deterministic synthetic demonstration data |
| examples/ | Small logs you can import and upload with the project |
| server.mjs | Local static server, with no runtime packages |
| tests/ | Node and Playwright tests |
| docs/ | Architecture notes and an interview demo guide |
| .vscode/ | Optional shared tasks and debugging configuration |
| .github/workflows/ | Continuous integration |

## Upload to GitHub

Upload the **contents of the project folder**, including public, examples, tests, docs, package.json, package-lock.json, server.mjs, README.md, and the configuration files.

Do not upload node_modules, test-results, or playwright-report; .gitignore excludes them. The included .vscode folder has portable shared tasks and launch settings, so it is safe to keep. Do not upload private incident logs or credentials.

Using Git from VS Code’s terminal avoids browser upload limits:

    git init
    git add .
    git commit -m "Build offline incident timeline and replay dashboard"
    git branch -M main
    git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPOSITORY.git
    git push -u origin main

Create an empty GitHub repository first and replace the remote URL with yours. If the folder is already a Git repository, skip git init and check its existing remote before changing it.

## Static hosting and development

Deploy the **contents of public/** to an HTTPS static host. There is no build step. The app uses relative URLs, so it can also live under a project subdirectory. Never deploy node_modules or the full project root as the public site.

For every release, change the cache version in public/sw.js so changed assets are downloaded. A newly installed worker waits for old tabs to close before taking over; this prevents mixing app versions. During development, enable **Application → Service Workers → Bypass for network** in Chromium developer tools to see source changes immediately. Turn that option off before testing offline behavior.

To regenerate the same sample data:

    npm run generate:sample

To choose another port on Windows PowerShell:

    $env:PORT=4174
    npm start

On macOS/Linux:

    PORT=4174 npm start

Open the corresponding localhost URL. Browser storage is tied to an origin, including its port.

## Scope and trade-offs

This is a functional frontend portfolio project for investigating imported logs. Replay visualizes recorded events; it does not rerun a backend incident. The parser reads a bounded file into memory rather than streaming arbitrarily large logs. Filtering is a linear worker scan, with a cached text index and small typed-index query responses. There is no live ingestion, authentication, shared server storage, or automatic root-cause detection.

See **docs/ARCHITECTURE.md** for implementation decisions and **docs/DEMO-AND-INTERVIEW.md** for a focused walkthrough.

Reference documentation: [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API), [Service Workers](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers), [Web Workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers).
