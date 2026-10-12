const express = require('express');
const axios = require('axios');
const { trace, SpanStatusCode } = require('@opentelemetry/api');
const sdk = require('./tracing');
const app = express();

// The frontend is served on a different port. This simple GET needs no preflight.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', 'http://localhost:3000');
  next();
});

app.get('/api/users/:id', async (req, res) => {
  // Read the span created by auto-instrumentation; do not create a trace ID.
  const span = trace.getActiveSpan();
  console.log(span)
  const context = span?.spanContext();
  console.log(`Service: app-service\nTrace ID: ${context?.traceId}\nSpan ID: ${context?.spanId}`);
  try {
    // Axios uses Node HTTP. OTel injects traceparent automatically here.
    const response = await axios.get(
      `http://localhost:3002/users/${encodeURIComponent(req.params.id)}`,
      { timeout: 5000, proxy: false, validateStatus: () => true },
    );
    if (response.status >= 400) {
      const message =
        response.data?.error || `Data Service returned HTTP ${response.status}`;

      span?.setStatus({ code: SpanStatusCode.ERROR, message });
      span?.setAttribute('error.message', message);
      span?.addEvent('user.request.failed', {
        'response.status_code': response.status,
        'error.message': message,
      });
    } else {
      span?.addEvent('user.request.succeeded', {
        'response.status_code': response.status,
        'user.id': String(response.data.id),
      });
    }
    console.log(span)
    res.status(response.status).json(response.data);
  } catch (error) {
    span?.recordException(error);
    span?.setStatus({ code: 2, message: error.message });
    console.error('Data Service request failed:', error.message);
    res.status(502).json({ error: 'Data Service is unavailable' });
  }
});

const server = app.listen(3001, () => console.log('App Service: http://localhost:3001'));
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => server.close(async () => {
    await sdk.shutdown();
    process.exit(0);
  }));
}
