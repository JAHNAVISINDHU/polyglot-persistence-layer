# ADR-001: Data Store Selection for the Logistics Platform

**Date:** 2024-01-15
**Status:** Accepted

---

### Context

The Real-Time Logistics Platform processes three fundamentally different categories of events, each with distinct query and persistence requirements:

1. **Driver Location Updates** — Require modeling relationships between moving entities (drivers) and geographic regions (zones). The natural query pattern is graph traversal.

2. **Package Status Changes** — Each package accumulates an unbounded history of status transitions. The natural query is document-oriented: give me the full chronological status history for package P.

3. **Billing Events** — Require strict transactional guarantees (exactly-once delivery, ACID compliance), structured schema validation, and financial auditability.

Choosing a single database for all three patterns would require compromising on either performance, data modeling naturalness, or query expressiveness. This leads us to a polyglot persistence architecture.

---

### Decision

We will use three specialized data stores, each chosen for a specific access pattern:

**Neo4j (Graph Database)** for `DRIVER_LOCATION_UPDATE`
- Driver-to-zone relationships are graph-native
- Cypher queries for zone membership are far more natural than SQL JOINs
- Nodes: `Driver`, `Zone` — Relationship: `LOCATED_IN`

**MongoDB (Document Database)** for `PACKAGE_STATUS_CHANGE`
- Each package is a self-contained document with a growing `status_history` array
- MongoDB's document model allows atomic array pushes without schema migrations
- Collection: `packages`

**PostgreSQL (Relational Database)** for `BILLING_EVENT`
- Financial data demands ACID transactions and unique constraints
- PostgreSQL enforces `UNIQUE` on `invoice_id` at the database level
- Table: `invoices`

---

### Consequences

**Positive:**
- Each store is used for its strongest use case, maximizing query performance
- Financial integrity enforced by PostgreSQL ACID guarantees and unique constraints
- MongoDB flexible schema supports evolving logistics event fields without migrations
- Neo4j enables future features like route optimization and zone heatmaps
- Eventual consistency model handles out-of-order billing via retry queue and reconciliation

**Negative / Trade-offs:**
- Operational complexity: three database systems to monitor and scale
- No cross-store transactions: consistency relies on application-level logic
- Unified querying requires fan-out to all three stores and merging in application memory
- Teams must understand Cypher, MQL, and SQL

**Mitigations:**
- Docker Compose orchestrates all services with health checks
- Retry queue and reconciliation process handle the primary eventual consistency challenge
- Unified query API abstracts polyglot complexity from consumers
