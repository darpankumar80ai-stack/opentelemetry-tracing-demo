# OpenTelemetry distributed tracing demo

A small plain JavaScript project: browser → App Service → Data Service → PostgreSQL.
Both Node services export spans to Jaeger over OTLP HTTP at `http://localhost:4318/v1/traces`.

## Requirements

- Node.js 22 or later and npm (tested with Node 24)
- Docker with Docker Compose, with the Docker engine running
- Python 3 to serve the frontend and run the optional verification script
- Free ports: 3000, 3001, 3002, 5432, 4318, 16686

## Run it

The project is located at `/Users/darpankumar/tracing-demo`. Start Docker Desktop, then open **four terminals** and run the commands below. Keep the two Node services and the frontend running in their terminals.

### Step 1 — PostgreSQL and Jaeger (terminal 1)

```sh
cd /Users/darpankumar/tracing-demo
docker compose up -d
docker compose ps
```

Wait for PostgreSQL to show `healthy` before making a request. The initialization SQL creates the `users` table and inserts Darpan and John only when the table is empty. Docker executes initialization scripts only when the database volume is first created. On later starts the existing table and data persist.

### Step 2 — Data Service (terminal 2)

```sh
cd /Users/darpankumar/tracing-demo/data-service
npm install
npm start
```

Listens at `http://localhost:3002`. `GET /users/:id` executes:

```sql
SELECT * FROM users WHERE id = $1
```

### Step 3 — App Service (terminal 3)

```sh
cd /Users/darpankumar/tracing-demo/app-service
npm install
npm start
```

Listens at `http://localhost:3001`. `GET /api/users/:id` calls Data Service through Axios and returns its JSON and status code.

### Step 4 — Frontend (terminal 4)

```sh
cd /Users/darpankumar/tracing-demo/frontend
python3 -m http.server 3000
```

### Step 5 — Make a request

Open `http://localhost:3000`, enter `1`, and click **Get User**. The result is:

```json
{"id":1,"name":"Darpan","email":"darpan@example.com"}
```

Try `2` for John. An unknown ID returns HTTP 404; an invalid ID returns HTTP 400.
You can also make the same request without a browser:

```sh
curl http://localhost:3001/api/users/1
```

### Step 6 — View the trace

Open `http://localhost:16686`. Select **app-service** in the **Service** dropdown and click **Find Traces**. Wait a few seconds and search again if necessary: the SDK exports spans in batches. Open the newest trace to see both `app-service` and `data-service` spans and the PostgreSQL query.

Expand the timeline rows and inspect each span's tags. The PostgreSQL span contains the SQL statement (`db.statement` or `db.query.text`, depending on instrumentation conventions), database identity, and elapsed time. Its service is **data-service**, because the instrumented `pg` client runs there. PostgreSQL itself does not run an OpenTelemetry SDK in this demo.

## How the IDs flow

One click creates one distributed backend trace. A trace ID is 32 hexadecimal characters and identifies the entire request. Each span ID is 16 hexadecimal characters and identifies one operation.

Conceptually:

```text
Trace ID: the same across all rows below
GET /api/users/:id                 app-service (HTTP server)
  └─ HTTP GET localhost:3002       app-service (HTTP client)
       └─ GET /users/:id           data-service (HTTP server)
            └─ SELECT users       data-service (PostgreSQL client)
```

Actual labels depend on instrumentation. Express also creates middleware/route-handler spans; these add rows to this simplified tree. All operations have distinct span IDs and parent references that connect the tree.

The frontend is intentionally just HTML and JavaScript, with no browser tracing SDK. It triggers the trace, which starts at App Service's incoming HTTP span. There is no browser span in Jaeger. The frontend does not generate or send a custom trace ID.

`npm start` uses `node --require ./tracing.js app.js` to initialize OpenTelemetry **before** loading Express, Axios, or `pg`. Starting with `node app.js` bypasses the required preload and will not instrument the already-loaded libraries correctly.

OpenTelemetry's HTTP instrumentation injects the W3C `traceparent` header into the Axios request. Data Service's HTTP instrumentation extracts it and creates a child server span with the same trace ID. A typical header has this shape:

```text
00-<32-character trace ID>-<16-character outgoing span ID>-01
```

No application code sets this header. The Node SDK supplies the context manager, default W3C propagation, and sampling. `pg` instrumentation creates a database span under the active request context.

Both handlers print the active span context using `trace.getActiveSpan()`. Compare the logs:

```text
Service: app-service
Trace ID: <same trace ID>
Span ID: <App Service active span ID>

Service: data-service
Trace ID: <same trace ID>
Span ID: <different Data Service active span ID>
```

The active span during an Express handler can be an Express span rather than the HTTP server span; that is expected. Each new click starts a new trace.

## Verify the full chain

With all services running, open another terminal:

```sh
cd /Users/darpankumar/tracing-demo
python3 scripts/verify.py
```

The script issues a request, polls Jaeger's query API, and checks that the corresponding trace has both service names, an App Service outgoing HTTP span, a Data Service incoming HTTP span, a PostgreSQL SELECT span, unique span IDs, and a complete parent chain. It also checks user 2, unknown/invalid IDs, and the frontend CORS response. It creates real traces and does not manually supply context headers.

For a direct database check:

```sh
docker compose exec postgres psql -U demo -d demo -c 'SELECT * FROM users ORDER BY id;'
```

## Dependencies and compatibility

Both services pin the same OpenTelemetry versions and include `package-lock.json`:

- `@opentelemetry/sdk-node`: 0.223.0
- `@opentelemetry/exporter-trace-otlp-proto`: 0.223.0
- `@opentelemetry/auto-instrumentations-node`: 0.81.0
- `@opentelemetry/api`: 1.9.1

The SDK/exporter use the same release version. The API and contrib instrumentation use different release numbering; matching every package's version number is not required. npm resolves their compatible core 2.x dependencies. Use `npm ci` instead of `npm install` when you want exactly the checked-in lockfile resolution. Only HTTP, Express, and PostgreSQL auto-instrumentation are enabled, to keep this demo's trace easy to read.

Jaeger is pinned to `jaegertracing/all-in-one:1.76.0` as requested. It enables OTLP collection and stores traces in memory, so restarting it clears the trace history. PostgreSQL is pinned to 17.6. These are local learning components with the requested demo credentials.

References: [OpenTelemetry Node SDK](https://open-telemetry.github.io/opentelemetry-js/modules/_opentelemetry_sdk-node.html), [automatic instrumentation](https://github.com/open-telemetry/opentelemetry-js-contrib/tree/main/packages/auto-instrumentations-node), and [Jaeger all-in-one deployment and ports](https://www.jaegertracing.io/docs/1.76/deployment/).

## Troubleshooting and stopping

- Docker connection error: start Docker Desktop and rerun Compose.
- Port already in use or “address already in use”: an earlier demo process may still be running. Stop it with Ctrl+C in its terminal before starting another copy.
- Database connection error: inspect `docker compose logs postgres` and wait for health to become healthy.
- Empty Jaeger search: make a request, wait for batch export, refresh the service list, and select `app-service`. Check service logs and `docker compose logs jaeger`.
- Frontend fetch error: use exactly `http://localhost:3000` (the allowed CORS origin), and check both Node processes.
- If a pre-existing database volume has a different schema or no seed data, rerun the idempotent SQL:

```sh
docker compose exec -T postgres psql -U demo -d demo < postgres/init.sql
```

Press Ctrl+C in the frontend and Node terminals. The Node services flush pending spans during shutdown. Stop containers with:

```sh
cd /Users/darpankumar/tracing-demo
docker compose down
```

To deliberately delete the database and recreate it with the sample data, run `docker compose down -v` followed by `docker compose up -d`. This deletes all data in this demo's PostgreSQL volume.
