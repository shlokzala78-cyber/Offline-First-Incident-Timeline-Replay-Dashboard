import { mkdir, writeFile } from 'node:fs/promises';
const start = Date.parse('2026-06-14T14:00:00Z');
const services = ['api-gateway', 'checkout', 'payment-service', 'inventory', 'auth-service', 'notification'];
const events = [];
for (let i = 0; i < 1080; i++) {
  const seconds = i * 1.35, service = services[i % services.length];
  const phase = seconds < 240 ? 'baseline' : seconds < 780 ? 'degraded' : seconds < 990 ? 'recovering' : 'healthy';
  const failing = phase === 'degraded' && ['checkout', 'payment-service', 'api-gateway'].includes(service);
  const recovering = phase === 'recovering' && service === 'payment-service';
  const level = failing ? (i % 13 === 0 ? 'critical' : i % 3 === 0 ? 'warn' : 'error') : recovering ? 'warn' : i % 17 === 0 ? 'debug' : 'info';
  const message = failing ? {
    checkout: 'Checkout stalled while waiting for payment authorization',
    'payment-service': i % 2 ? 'Connection pool exhausted: payment request timed out' : 'Upstream payment provider exceeded retry budget',
    'api-gateway': 'Elevated latency on POST /api/checkout'
  }[service] : recovering ? 'Payment queue draining after connection pool adjustment' : {
    'api-gateway': 'Request completed successfully',
    checkout: 'Checkout session processed',
    'payment-service': 'Payment authorization completed',
    inventory: 'Stock reservation confirmed',
    'auth-service': 'Session token validated',
    notification: 'Order confirmation queued'
  }[service];
  events.push({
    id: 'evt-' + String(i + 1).padStart(5, '0'), timestamp: new Date(start + Math.round(seconds * 1000)).toISOString(),
    service, level, message, traceId: 'trace-' + String(Math.floor(i / 6) + 1).padStart(4, '0'),
    durationMs: failing ? 2400 + i % 11 * 130 : recovering ? 650 + i % 7 * 90 : 18 + i % 19 * 7,
    metadata: { region: 'us-east-1', instance: service + '-' + (i % 3 + 1), phase, statusCode: failing ? 504 : 200, release: 'v2.14.0' }
  });
}
const milestones = [
  [225000, 'deployment', 'info', 'Release v2.14.0 deployed to payment-service', { change: 'Connection pool default reduced from 40 to 8' }],
  [244000, 'payment-service', 'critical', 'Payment connection pool saturated: active=8, waiting=127', { activeConnections: 8, queuedRequests: 127 }],
  [778000, 'payment-service', 'warn', 'Mitigation applied: connection pool restored to 40', { activeConnections: 40, operator: 'demo-oncall' }],
  [990000, 'checkout', 'info', 'Checkout latency returned to baseline', { p95Ms: 183 }]
];
for (const [offset, service, level, message, metadata] of milestones) events.push({ id: 'milestone-' + offset, timestamp: new Date(start + offset).toISOString(), service: service === 'deployment' ? 'payment-service' : service, level, message, traceId: '', metadata });
events.sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id));
const sample = {
  title: 'Checkout latency spike', events,
  bookmarks: ['milestone-225000', 'milestone-244000', 'milestone-778000', 'milestone-990000'],
  notes: { 'milestone-225000': 'Sample investigation: the pool-size change precedes the first saturation event. Correlation is a lead, not proof of causation.', 'milestone-778000': 'Mitigation is followed by a draining queue and lower latency.' }
};
await mkdir(new URL('../public/data/', import.meta.url), { recursive: true });
await writeFile(new URL('../public/data/sample-incident.json', import.meta.url), JSON.stringify(sample, null, 2) + '\n');
console.log('Generated ' + events.length + ' deterministic sample events across ' + services.length + ' services.');
