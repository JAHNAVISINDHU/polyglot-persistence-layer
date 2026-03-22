# ADR-001: Data Store Selection for the Logistics Platform

**Date:** 2024-01-15  
**Status:** Accepted  
**Deciders:** Platform Architecture Team

---

## Context

The Real-Time Logistics Platform processes three fundamentally different categories of events, each with distinct query and persistence requirements:

1. **Driver Location Updates** — Require modeling relationships between moving entities (drivers) and geographic regions (zones). The natural query pattern is graph traversal: *"Which drivers are in zone X?"* or *"What is the current zone of driver Y?"*

2. **Package Status Changes** — Each package accumulates an unbounded history of status transitions. The natural query is document-oriented: *"Give me the full chronological status history for package P."* There is no need for cross-package JOINs.

3. **Billing Events** — Require strict transactional guarantees (exactly-once delivery, ACID compliance), structured schema validation, and financial auditability. The invoice model is highly relational with clear foreign key semantics.

Choosing a single database for all three patterns would require compromising on either performance, data modeling naturalness, or query expressiveness. This leads us to a **polyglot persistence** architecture.

---

### Options Considered

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| A | Single PostgreSQL for everything | Simplicity, ACID everywhere | Poor graph traversal; document arrays are awkward |
| B | Single MongoDB for everything | Flexible schema | No native graph; weak financial transaction guarantees |
| C | Neo4j + MongoDB + PostgreSQL (chosen) | Best-fit per domain | More operational complexity |

---

## Decision

We will use **three specialized data stores**, each chosen for a specific access pattern:

### 1. Neo4j (Graph Database) — for `DRIVER_LOCATION_UPDATE`

**Why:** Driver-to-zone relationships are graph-native. Neo4j's property graph model directly represents `(:Driver)-[:LOCATED_IN]->(:Zone)` relationships. Cypher queries for zone membership, nearest-driver lookups, or multi-hop routing are far more natural and performant than SQL JOINs or document array scans.

**Nodes:** `Driver`, `Zone`  
**Relationships:** `LOCATED_IN`

### 2. MongoDB (Document Database) — for `PACKAGE_STATUS_CHANGE`

**Why:** Each package is a self-contained document with a growing `status_history` array. MongoDB's document model allows atomic array pushes (`$push`) without requiring schema migrations. There is no need to JOIN across packages. Flexible schema also allows future event fields to be added without downtime.

**Collection:** `packages`  
**Key pattern:** `{ package_id: "...", status_history: [...] }`

### 3. PostgreSQL (Relational Database) — for `BILLING_EVENT`

**Why:** Financial data demands ACID transactions, unique constraints, and auditability. PostgreSQL enforces `UNIQUE` on `invoice_id` at the database level, preventing duplicate billing with zero application-level coordination. SQL is ideal for financial reporting queries (aggregation, filtering by customer/amount/date range).

**Table:** `invoices`  
**Key constraint:** `invoice_id UNIQUE`

---

## Consequences

### Positive

- Each store is used for its strongest use case, maximizing query performance and expressiveness.
- Financial integrity is enforced by PostgreSQL's ACID guarantees and unique constraints.
- MongoDB's flexible schema supports evolving logistics event fields without migrations.
- Neo4j enables future features like route optimization, zone heatmaps, and driver clustering queries.
- The system demonstrates the **eventual consistency** model: billing events deferred via `retry_queue.json` are reconciled once delivery is confirmed in MongoDB.

### Negative / Trade-offs

- **Operational complexity:** Three database systems to monitor, back up, and scale independently.
- **No cross-store transactions:** Consistency across stores relies on application-level logic (retry queue + reconciliation), not distributed transactions.
- **Unified querying is non-trivial:** The `/query/package/:id` endpoint must fan out to all three stores and merge results in application memory.
- **Learning curve:** Teams must understand Cypher (Neo4j), MQL (MongoDB), and SQL (PostgreSQL).

### Mitigations

- Docker Compose orchestrates all three services with health checks, minimizing local setup friction.
- The retry queue and reconciliation process handle the primary eventual consistency challenge (billing before delivery).
- The unified query API abstracts polyglot complexity from API consumers.

---

*This ADR should be revisited if event volume exceeds 10M/day or if a new event category is introduced that doesn't fit the existing three stores.*
