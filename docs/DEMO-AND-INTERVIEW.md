# Demo and interview guide

## Explain the user value first

“Traceback helps a developer investigate an outage using exported application logs. They can put events from several services on one timeline, replay the sequence, filter the noise, and save notes about important evidence. The investigation remains available after the app has been cached, even when their connection drops. They can also export their work and hand it to another developer.”

This describes the application’s capabilities. Do not claim real customers, production use, measured downtime reduction, or performance results you have not demonstrated.

## A two-minute demonstration

1. Start with the sample checkout incident and point out its six services.
2. Replay at 120×. Explain that the cursor reveals recorded events in timestamp order.
3. Filter to payment-service and search for “pool”. Show how that isolates relevant evidence.
4. Open the deployment milestone and read the sample note. Explain that a nearby deployment is an investigative lead, not automatic proof of the cause.
5. Bookmark an event and write a short note about what you would check next.
6. Switch the browser to offline mode and reload after the cache and save finish.
7. Show that the investigation returns. Export it and explain that this file carries logs, notes, bookmarks, and view state.

For a very short demo, use examples/mini-incident.jsonl: five events make replay stepping easy to see.

## Technical follow-ups

**Why a Web Worker?** Parsing and repeated filtering can compete with typing, scrolling, and paint on the main thread. The worker handles parsing and scans, while the main thread renders results. It returns typed event indices instead of copying every matching event for each query.

**Why virtualization?** Creating a row for every event would make the DOM unnecessarily large. Fixed-height rows let the application calculate which records intersect the viewport and render only those rows plus overscan.

**How does offline support work?** The Service Worker caches the interface and local assets. IndexedDB stores the investigation. Both are needed: caching HTML alone would not restore imported logs and notes.

**How do you prevent stale search results?** Requests carry IDs and the application tracks the latest view revision. A response for an older view is ignored; the next queued scan uses the latest parameters.

**How does recovery work?** The app saves a dataset and workspace in a single IndexedDB transaction, tracks the last-opened investigation, and restores its sanitized view on startup. Saves are serialized and capture their dataset identity before queuing.

**What makes a link shareable?** It serializes the investigation identity and view into a URL fragment. It does not contain the dataset. A recipient imports the same investigation and opens the link on an accessible deployment.

**What is the main trade-off?** The project favors a self-contained, local workflow. It does not provide cloud collaboration or unlimited log processing. Imports have explicit size limits, and filtering is still a linear scan performed in the worker.

**How was it tested?** At handoff, 20 Node tests passed, including worker integration, fake IndexedDB recovery/rollback, cache-policy simulation, and a 100,000-event correctness test. A 12-case Playwright suite is included but must be run locally or in GitHub Actions before you claim browser verification.

## Prepare before presenting

Read the modules you plan to discuss. Run the demo and test suite yourself. Make a small change, such as adding a service filter option or an extra detail field, so you understand how state moves through the application. Be accurate about any assistance used to build it and about the parts you personally understand and can maintain.
