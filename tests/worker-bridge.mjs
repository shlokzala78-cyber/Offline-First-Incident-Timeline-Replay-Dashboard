import { parentPort } from 'node:worker_threads';
globalThis.self = {
  addEventListener(type, callback) { if (type === 'message') parentPort.on('message', data => callback({ data })); },
  postMessage(message, transfer) { parentPort.postMessage(message, transfer); }
};
await import('../public/js/processor.worker.js');
parentPort.postMessage({ ready: true });
