// Preloaded by npm start BEFORE Express, HTTP clients, or pg are imported.
const { NodeSDK } = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-proto');

process.env.OTEL_NODE_ENABLED_INSTRUMENTATIONS = 'http,express,pg';
console.log("tracing is loading")
const sdk = new NodeSDK({
  serviceName: 'app-service',
  traceExporter: new OTLPTraceExporter({
    url: 'http://localhost:4318/v1/traces',
  }),
  // Only the instrumentation relevant to this demo is enabled.
  // HTTP instrumentation automatically injects/extracts W3C traceparent.
  instrumentations: [getNodeAutoInstrumentations({
    '@opentelemetry/instrumentation-http': { enabled: true },
    '@opentelemetry/instrumentation-express': { enabled: true },
    '@opentelemetry/instrumentation-pg': { enabled: true },
  })],
});
sdk.start();
console.log("tracing is start")
// Flush pending spans when the process exits normally (including Ctrl+C).
module.exports = sdk;
