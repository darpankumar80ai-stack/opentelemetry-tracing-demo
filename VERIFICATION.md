# Verification performed

Verified on October 11, 2026 with Node.js 24.19.0, npm 11.17.0 and Docker Engine 29.8.0.

- Both `npm install` commands passed and reported zero vulnerabilities.
- `npm ls --depth=0` passed for both services; direct imports resolved and JavaScript syntax checks passed.
- Docker Compose configuration validated; PostgreSQL became healthy and both seed users were confirmed with `psql`.
- Both services started with their documented `npm start` commands.
- The actual frontend Get User button displayed HTTP 200 and Darpan's JSON.
- `python3 scripts/verify.py` passed: both users, unknown ID (404), invalid ID and integer overflow (400), frontend CORS, connected trace parent chain, distinct span IDs, and PostgreSQL SELECT exported to Jaeger.
- The resulting trace was opened in Jaeger UI, which showed two services and nine spans.

Observed trace ID: `3460e9ae355d279332b30867bda1e574`

| Operation | Service | Span ID |
| --- | --- | --- |
| GET /api/users/:id | app-service | 2bc0a1e5c8a31d09 |
| Outgoing GET | app-service | e52cb6d17935604d |
| GET /users/:id | data-service | b492550df97e28cc |
| pg.query:SELECT demo | data-service | 2763f9a9b7ede288 |

A separate request's console logs showed the same trace ID in both handlers (`16943184419b15390bc0a0b998a7f5a5`) with different active Express span IDs (`55b3718c4e63c8e2` and `c7b14c0b4502f1bd`). These belong to the handler spans, not the HTTP spans in the table above.

See `frontend-result.jpg` and `jaeger-trace.jpg` for the observed browser results. The saved IDs document this run; every subsequent request gets a new trace ID. Jaeger uses memory storage, so links to these traces last only until Jaeger restarts.
