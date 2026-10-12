const express = require('express');
const { Pool } = require('pg');
const { trace } = require('@opentelemetry/api');
const sdk = require('./tracing');
const app = express();
const pool = new Pool({
  host: 'localhost', port: 5432, database: 'demo', user: 'demo', password: 'demo',
  connectionTimeoutMillis: 5000,
});
pool.on('error', error => console.error('PostgreSQL pool error:', error.message));

app.get('/users/:id', async (req, res) => {
  // HTTP instrumentation has already extracted the upstream traceparent.
  const span = trace.getActiveSpan();
  const context = span?.spanContext();
  console.log(`Service: data-service\nTrace ID: ${context?.traceId}\nSpan ID: ${context?.spanId}`);
  const id = Number(req.params.id);
  if (!/^\d+$/.test(req.params.id) || !Number.isSafeInteger(id) || id < 1 || id > 2147483647) {
    return res.status(400).json({ error: 'User ID must be a positive 32-bit integer' });
  }
  try {
    // Parameterized query is safe; pg instrumentation creates its own DB span.
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    if (!result.rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (error) {
    span?.recordException(error);
    span?.setStatus({ code: 2, message: error.message });
    console.error('PostgreSQL query failed:', error.message);
    res.status(500).json({ error: 'Database query failed' });
  }
});

const server = app.listen(3002, () => console.log('Data Service: http://localhost:3002'));
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => server.close(async () => {
    await pool.end();
    await sdk.shutdown();
    process.exit(0);
  }));
}
