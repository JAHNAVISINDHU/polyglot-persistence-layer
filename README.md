# 🚚 Polyglot Persistence Layer — Real-Time Logistics Platform

A production-grade data processing pipeline that routes logistics events to three specialized databases, each chosen for a specific query pattern. Implements an **eventual consistency model** with a retry queue, and exposes a **unified query API** that merges data from all three stores.

---

## 📐 Architecture Overview

```
events.log
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│                   Event Router (Node.js)                 │
│                                                         │
│  ┌──────────────────────────────────────────────────┐  │
│  │              Log Ingestion Pipeline               │  │
│  │  - Line-by-line JSON parsing                     │  │
│  │  - Malformed line error handling (no crash)      │  │
│  │  - Event type dispatch                           │  │
│  └──────────────┬──────────────┬───────────────────┘  │
│                 │              │              │          │
│                 ▼              ▼              ▼          │
│         DRIVER_LOCATION  PACKAGE_STATUS  BILLING_EVENT  │
│         _UPDATE          _CHANGE                        │
└────────────────┼──────────────┼──────────────┼──────────┘
                 │              │              │
                 ▼              ▼              ▼
          ┌──────────┐  ┌──────────┐  ┌──────────────┐
          │  Neo4j   │  │ MongoDB  │  │  PostgreSQL  │
          │ (Graph)  │  │  (Doc)   │  │  (Relational)│
          │          │  │          │  │              │
          │ Driver   │  │ packages │  │  invoices    │
          │ Zone     │  │ (with    │  │  table       │
          │ LOCATED  │  │  status  │  │  (ACID +     │
          │ _IN rel  │  │  history)│  │   UNIQUE)    │
          └──────────┘  └──────────┘  └──────┬───────┘
                                             │
                                    ┌────────┴──────────┐
                                    │   retry_queue.json │
                                    │  (if pkg NOT yet  │
                                    │   DELIVERED)      │
                                    └───────────────────┘
                                             │
                                    ┌────────┴──────────┐
                                    │   Reconciliation  │
                                    │   Process         │
                                    │  (re-checks &     │
                                    │   re-inserts)     │
                                    └───────────────────┘

         ┌──────────────────────────────────────────┐
         │         Unified Query API (Express)       │
         │   GET /query/package/:id                  │
         │   → merges all 3 stores, sorted by time  │
         └──────────────────────────────────────────┘
```

---

## 🗄️ Database Responsibilities

| Store | Technology | Event Type | Why This Store |
|-------|-----------|-----------|----------------|
| **Graph** | Neo4j | `DRIVER_LOCATION_UPDATE` | Driver↔Zone relationships are graph-native. Cypher traversals are far more natural than SQL JOINs. |
| **Document** | MongoDB | `PACKAGE_STATUS_CHANGE` | Each package is a self-contained document with a growing status history array. No cross-package JOINs needed. |
| **Relational** | PostgreSQL | `BILLING_EVENT` | Financial data needs ACID guarantees, `UNIQUE` constraint on `invoice_id`, and structured auditability. |

---

## 📦 Project Structure

```
logistics-platform/
├── docker-compose.yml          # Orchestrates all 4 services
├── .env.example                # All required environment variables
├── events.log                  # Input event log (mounted into app container)
├── retry_queue.json            # Persistent deferred billing events
├── docs/
│   └── ADR-001-Data-Store-Selection.md   # Architecture Decision Record
├── scripts/
│   └── init_postgres.sql       # Auto-run schema on first PostgreSQL start
└── app/
    ├── Dockerfile
    ├── package.json
    └── src/
        ├── index.js                        # Entry point + startup orchestration
        ├── databases/
        │   ├── postgres.js                 # PostgreSQL connection pool
        │   ├── mongo.js                    # MongoDB client
        │   └── neo4j.js                    # Neo4j driver
        ├── ingestion/
        │   ├── logProcessor.js             # Line-by-line log reader
        │   └── eventHandlers.js            # Per-event-type persistence logic
        ├── reconciliation/
        │   └── reconciler.js               # Retry queue processor
        ├── api/
        │   └── routes.js                   # Express route handlers
        └── utils/
            ├── logger.js                   # Winston structured logger
            └── retryQueue.js               # retry_queue.json read/write
```

---

## 🚀 Quick Start

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) ≥ 24
- [Docker Compose](https://docs.docker.com/compose/) ≥ 2.20
- 4 GB RAM available for containers

### 1. Clone & Configure

```bash
git clone <your-repo-url>
cd logistics-platform

# Copy and optionally edit environment variables
cp .env.example .env
```

### 2. Start All Services

```bash
docker compose up --build
```

This will:
1. Start **PostgreSQL**, **MongoDB**, and **Neo4j** with health checks
2. Wait for all three databases to be **healthy** before starting the app
3. Auto-run `scripts/init_postgres.sql` to create the `invoices` table
4. Start the **Node.js app**, which immediately ingests `events.log`
5. Run the **reconciliation pass** to process any deferred billing events
6. Start the **REST API** on port `3000`

Expected startup output:
```
logistics_app | [info]: Starting logistics platform...
logistics_app | [info]: All database connections established
logistics_app | [info]: Starting automatic event ingestion...
logistics_app | [info]: Log file ingestion complete { processed: 16, errors: 1, skipped: 0 }
logistics_app | [error]: Malformed JSON line in events.log, skipping { lineNumber: 16, ... }
logistics_app | [info]: Running reconciliation pass...
logistics_app | [info]: API server listening on port 3000
```

---

## 📡 API Reference

All endpoints are served at `http://localhost:3000`.

### `GET /query/package/:package_id`

Returns a **chronologically sorted, unified history** for a package across all three data stores.

```bash
curl http://localhost:3000/query/package/pkg-test-456
```

**Response `200 OK`:**
```json
[
  {
    "source_system": "document_store",
    "timestamp": "2024-01-15T08:15:00Z",
    "event_details": {
      "status": "PICKED_UP",
      "driver_id": "drv-test-123",
      "location": "Warehouse A",
      "event_id": "evt-004"
    }
  },
  {
    "source_system": "document_store",
    "timestamp": "2024-01-15T08:30:00Z",
    "event_details": {
      "status": "IN_TRANSIT",
      ...
    }
  },
  {
    "source_system": "document_store",
    "timestamp": "2024-01-15T09:00:00Z",
    "event_details": {
      "status": "DELIVERED",
      ...
    }
  }
]
```

Each object conforms to:
```json
{
  "source_system": "document_store | relational_store | graph_store",
  "timestamp": "<ISO 8601>",
  "event_details": { ... }
}
```

---

### `GET /query/health`

Returns database connectivity status.

```bash
curl http://localhost:3000/query/health
```

```json
{
  "status": "ok",
  "databases": {
    "postgres": "healthy",
    "mongo": "healthy",
    "neo4j": "healthy"
  }
}
```

---

### `GET /query/queue`

Inspect the current retry queue contents.

```bash
curl http://localhost:3000/query/queue
```

```json
{
  "count": 1,
  "events": [
    {
      "event_type": "BILLING_EVENT",
      "invoice_id": "inv-002",
      "package_id": "pkg-out-of-order-123",
      ...
    }
  ]
}
```

---

### `POST /query/ingest`

Manually trigger re-ingestion of `events.log` followed by reconciliation.

```bash
curl -X POST http://localhost:3000/query/ingest
```

```json
{
  "message": "Ingestion complete",
  "stats": { "processed": 16, "errors": 1, "skipped": 0 }
}
```

---

### `POST /query/reconcile`

Manually trigger the reconciliation process (process deferred billing events).

```bash
curl -X POST http://localhost:3000/query/reconcile
```

```json
{
  "message": "Reconciliation complete",
  "result": { "processed": 1, "remaining": 0 }
}
```

---

## 🔌 Event Log Format

`events.log` contains one JSON object per line. Three event types are supported:

### `DRIVER_LOCATION_UPDATE`
```json
{
  "event_type": "DRIVER_LOCATION_UPDATE",
  "event_id": "evt-001",
  "timestamp": "2024-01-15T08:00:00Z",
  "driver_id": "drv-test-123",
  "latitude": 17.385,
  "longitude": 78.4867,
  "zone_id": "zone-test-abc"
}
```
→ Persisted to **Neo4j** as `(:Driver)-[:LOCATED_IN]->(:Zone)`

### `PACKAGE_STATUS_CHANGE`
```json
{
  "event_type": "PACKAGE_STATUS_CHANGE",
  "event_id": "evt-004",
  "timestamp": "2024-01-15T08:15:00Z",
  "package_id": "pkg-test-456",
  "status": "PICKED_UP",
  "driver_id": "drv-test-123",
  "location": "Warehouse A"
}
```
→ Upserted to **MongoDB** `packages` collection, appended to `status_history`

### `BILLING_EVENT`
```json
{
  "event_type": "BILLING_EVENT",
  "event_id": "evt-009",
  "timestamp": "2024-01-15T09:35:00Z",
  "invoice_id": "inv-001",
  "package_id": "pkg-test-789",
  "amount": 25.50,
  "customer_id": "cust-001",
  "currency": "USD"
}
```
→ Inserted into **PostgreSQL** `invoices` table **only if** the package status is `DELIVERED` in MongoDB. Otherwise deferred to `retry_queue.json`.

---

## ⚙️ Eventual Consistency & Retry Queue

The platform implements an **eventual consistency model** for billing events:

```
BILLING_EVENT arrives
        │
        ▼
 Is package DELIVERED
 in MongoDB?
        │
   YES  │  NO
   ┌────┘  └────────────────────────┐
   ▼                                ▼
INSERT into                  Append to
PostgreSQL                   retry_queue.json
invoices                          │
                                  │ (on next reconciliation)
                                  ▼
                         Re-check MongoDB
                                  │
                         DELIVERED? → INSERT
                         NOT YET?  → Stay in queue
```

**`retry_queue.json`** is a JSON array on disk, mounted as a Docker volume so it persists across container restarts.

---

## 🗃️ Database Schemas

### Neo4j Graph Schema

```
(:Driver {
  driverId: String,      // e.g. "drv-test-123"
  latitude: Float,
  longitude: Float,
  lastSeen: String,      // ISO 8601
  eventId: String
})-[:LOCATED_IN {
  timestamp: String
}]->(:Zone {
  zoneId: String         // e.g. "zone-test-abc"
})
```

**Useful Cypher queries:**
```cypher
-- Find driver's current zone
MATCH (d:Driver {driverId: 'drv-test-123'})-[:LOCATED_IN]->(z:Zone)
RETURN d, z.zoneId

-- Find all drivers in a zone
MATCH (d:Driver)-[:LOCATED_IN]->(z:Zone {zoneId: 'zone-test-abc'})
RETURN d.driverId, d.latitude, d.longitude
```

---

### MongoDB Document Schema

**Collection:** `packages`

```json
{
  "_id": ObjectId("..."),
  "package_id": "pkg-test-456",
  "updated_at": "2024-01-15T09:00:00Z",
  "status_history": [
    {
      "status": "PICKED_UP",
      "timestamp": "2024-01-15T08:15:00Z",
      "driver_id": "drv-test-123",
      "location": "Warehouse A",
      "event_id": "evt-004"
    },
    {
      "status": "IN_TRANSIT",
      "timestamp": "2024-01-15T08:30:00Z",
      ...
    },
    {
      "status": "DELIVERED",
      "timestamp": "2024-01-15T09:00:00Z",
      ...
    }
  ]
}
```

**Useful MQL queries:**
```javascript
// Find package and its status history
db.packages.findOne({ package_id: "pkg-test-456" })

// Find all delivered packages
db.packages.find({ "status_history.status": "DELIVERED" })
```

---

### PostgreSQL Relational Schema

**Table:** `invoices`

```sql
CREATE TABLE invoices (
    id          SERIAL PRIMARY KEY,
    invoice_id  VARCHAR(255) UNIQUE NOT NULL,   -- enforces exactly-once
    package_id  VARCHAR(255) NOT NULL,
    amount      DECIMAL(10,2) NOT NULL,
    customer_id VARCHAR(255) NOT NULL,
    currency    VARCHAR(10) DEFAULT 'USD',
    event_id    VARCHAR(255),
    timestamp   TIMESTAMPTZ,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);
```

**Useful SQL queries:**
```sql
-- Get invoice for a package
SELECT * FROM invoices WHERE package_id = 'pkg-test-789';

-- Total revenue by customer
SELECT customer_id, SUM(amount) FROM invoices GROUP BY customer_id;

-- All invoices today
SELECT * FROM invoices WHERE created_at::date = CURRENT_DATE;
```

---

## 🧪 Verification Scenarios

The following scenarios test each requirement. Run them after `docker compose up`.

### 1. Graph Store — Driver Location

```bash
# Connect to Neo4j browser at http://localhost:7474
# Username: neo4j, Password: logistics_pass

# Or via cypher-shell in container:
docker exec -it logistics_neo4j cypher-shell \
  -u neo4j -p logistics_pass \
  "MATCH (d:Driver {driverId: 'drv-test-123'})-[:LOCATED_IN]->(z:Zone) RETURN d, z.zoneId"
```

Expected: Returns driver `drv-test-123` in zone `zone-test-abc`.

---

### 2. Document Store — Package Status History

```bash
docker exec -it logistics_mongo mongosh \
  -u logistics -p logistics_pass \
  --authenticationDatabase admin \
  logistics_db \
  --eval "db.packages.findOne({package_id: 'pkg-test-456'})"
```

Expected: Document with `status_history` array containing 3 elements (PICKED_UP, IN_TRANSIT, DELIVERED).

---

### 3. Relational Store — Invoice

```bash
docker exec -it logistics_postgres psql \
  -U logistics -d logistics_db \
  -c "SELECT * FROM invoices WHERE package_id = 'pkg-test-789';"
```

Expected: One row with correct amount and customer.

---

### 4. Duplicate Invoice Prevention

```bash
# The events.log already contains two identical BILLING_EVENTs for inv-001
docker exec -it logistics_postgres psql \
  -U logistics -d logistics_db \
  -c "SELECT COUNT(*) FROM invoices WHERE invoice_id = 'inv-001';"
```

Expected: `count = 1`. Check app logs for "Duplicate invoice_id detected" error message.

---

### 5. Out-of-Order Billing (Retry Queue)

```bash
# pkg-out-of-order-123 receives a BILLING_EVENT before DELIVERED status
# Check the retry queue
curl http://localhost:3000/query/queue

# Confirm no invoice was inserted yet
docker exec -it logistics_postgres psql \
  -U logistics -d logistics_db \
  -c "SELECT * FROM invoices WHERE package_id = 'pkg-out-of-order-123';"
```

Expected: Queue contains the deferred event; no invoice row exists.

---

### 6. Reconciliation

To test full reconciliation:

```bash
# 1. Add a DELIVERED event for the out-of-order package to events.log
echo '{"event_type":"PACKAGE_STATUS_CHANGE","event_id":"evt-rec-01","timestamp":"2024-01-15T12:00:00Z","package_id":"pkg-out-of-order-123","status":"DELIVERED","driver_id":"drv-456","location":"Final Stop"}' >> events.log

# 2. Trigger re-ingestion + reconciliation
curl -X POST http://localhost:3000/query/ingest

# 3. Verify invoice was created
docker exec -it logistics_postgres psql \
  -U logistics -d logistics_db \
  -c "SELECT * FROM invoices WHERE package_id = 'pkg-out-of-order-123';"

# 4. Verify queue is now empty
curl http://localhost:3000/query/queue
```

Expected: Invoice exists; queue is empty.

---

### 7. Unified Package History

```bash
curl http://localhost:3000/query/package/pkg-complete-history-101 | python3 -m json.tool
```

Expected: JSON array with events from at least 2 source systems, sorted by timestamp ascending.

---

### 8. Malformed Line Handling

Check that the app did not crash despite the malformed JSON line:

```bash
docker logs logistics_app | grep -i "malformed"
# Should show: [error]: Malformed JSON line in events.log, skipping
```

---

## 🔧 Configuration

All configuration is done via environment variables. Copy `.env.example` to `.env` and adjust:

| Variable | Default | Description |
|----------|---------|-------------|
| `POSTGRES_USER` | `logistics` | PostgreSQL username |
| `POSTGRES_PASSWORD` | `logistics_pass` | PostgreSQL password |
| `POSTGRES_DB` | `logistics_db` | PostgreSQL database name |
| `POSTGRES_HOST` | `postgres` | PostgreSQL host (Docker service name) |
| `POSTGRES_PORT` | `5432` | PostgreSQL port |
| `MONGO_USER` | `logistics` | MongoDB username |
| `MONGO_PASSWORD` | `logistics_pass` | MongoDB password |
| `MONGO_DB` | `logistics_db` | MongoDB database name |
| `MONGO_URI` | *(constructed)* | Full MongoDB connection URI |
| `NEO4J_URI` | `bolt://neo4j:7687` | Neo4j Bolt URI |
| `NEO4J_USER` | `neo4j` | Neo4j username |
| `NEO4J_PASSWORD` | `logistics_pass` | Neo4j password |
| `APP_PORT` | `3000` | Port the API listens on |
| `LOG_LEVEL` | `info` | Winston log level (`debug`, `info`, `warn`, `error`) |

---

## 🛑 Stopping & Cleanup

```bash
# Stop containers (preserves volumes)
docker compose down

# Stop and remove all data volumes (full reset)
docker compose down -v

# Rebuild after code changes
docker compose up --build
```

---

## 🧰 Development

To run the app locally (without Docker), install Node.js 18+ and start the databases separately, then:

```bash
cd app
npm install
cp ../.env.example .env
# Edit .env with local database connection strings
node src/index.js
```

---

## 📋 Requirements Compliance Matrix

| # | Requirement | Implementation |
|---|-------------|---------------|
| 1 | Docker Compose with 4+ services + health checks | `docker-compose.yml` — postgres, mongo, neo4j, app with healthchecks |
| 2 | Auto-ingest `events.log` on startup, handle malformed lines | `src/ingestion/logProcessor.js` — readline, try/catch per line |
| 3 | `DRIVER_LOCATION_UPDATE` → Neo4j with Driver, Zone, LOCATED_IN | `src/ingestion/eventHandlers.js` → `handleDriverLocationUpdate` |
| 4 | `PACKAGE_STATUS_CHANGE` → MongoDB packages collection with status_history | `handlePackageStatusChange` — `$push` with upsert |
| 5 | `BILLING_EVENT` → PostgreSQL invoices table | `handleBillingEvent` → `insertInvoice` |
| 6 | Duplicate `invoice_id` prevented by UNIQUE constraint + logged | PostgreSQL `UNIQUE` constraint + error code `23505` handling |
| 7 | Pre-delivery billing event → `retry_queue.json` | `retryQueue.enqueue()` in `handleBillingEvent` |
| 8 | Reconciliation processes retry queue after DELIVERED arrives | `src/reconciliation/reconciler.js` |
| 9 | `GET /query/package/:id` → unified sorted history from all 3 stores | `src/api/routes.js` |
| 10 | ADR document at `docs/ADR-001-Data-Store-Selection.md` | ✅ Present with Context, Decision, Consequences |
| 11 | `.env.example` with all DB connection variables | ✅ Present at project root |

---

## 📄 License

MIT
