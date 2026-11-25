---
name: typeorm
description: "TypeORM patterns and database development guidelines.\nTRIGGER when: planning or implementing features involving database, TypeORM entities, repositories, migrations, queries, or data source configuration.\nDO NOT TRIGGER when: only reading database code without intent to modify, working on frontend, or asking general TypeScript questions."
---

# TypeORM Development Guidelines

Expert guidance for TypeORM with TypeScript, focused on the Data Mapper pattern, PostgreSQL, and enterprise application architecture.

**Core principles:** explicit types on all columns, Data Mapper over Active Record, migrations over synchronize, environment-based configuration, and bidirectional relationships with explicit foreign keys.

## Rules Index

Rules are organized by priority. Load the relevant rule file when working on that topic.

### CRITICAL — Configuration

- `rules/config-datasource-setup.md` — DataSource with env vars, pooling, SSL. Never hardcode credentials.
- `rules/config-typescript-settings.md` — Required tsconfig flags for decorators and metadata.

### CRITICAL — Entity Design

- `rules/entity-define-proper-structure.md` — Explicit table names, typed columns, timestamps.
- `rules/entity-primary-key-strategy.md` — Auto-increment vs UUID vs composite PK by context.
- `rules/entity-column-types.md` — Explicit column types, enums, JSON, soft delete, versioning.

### HIGH — Relationships

- `rules/rel-one-to-one-and-many.md` — Bidirectional OneToOne/OneToMany with JoinColumn and FK.
- `rules/rel-many-to-many.md` — ManyToMany with explicit JoinTable configuration.

### HIGH — Query Patterns

- `rules/query-repository-basics.md` — Repository CRUD: create, save, find, delete, softDelete.
- `rules/query-custom-repository.md` — Custom repositories for domain-specific queries.
- `rules/query-builder-and-n-plus-one.md` — QueryBuilder usage and N+1 prevention.

### HIGH — Migrations

- `rules/migration-workflow.md` — CLI commands, workflow, and why synchronize must be false.
- `rules/migration-file-structure.md` — Reversible migrations with proper up/down methods.

### MEDIUM-HIGH — Transactions

- `rules/tx-use-transactions.md` — QueryRunner and transaction callback for multi-entity writes.

### MEDIUM — Integration

- `rules/integ-nestjs-setup.md` — NestJS forRoot/forFeature setup with DI.

### MEDIUM — Conventions

- `rules/conv-eager-lazy-loading.md` — Explicit loading over eager/lazy; when to use each.
- `rules/conv-indexes-naming-cascades.md` — Indexes, SnakeNamingStrategy, cascade operations.

## Quick Reference

| Topic | Key Rule |
|-------|----------|
| New entity | Always: explicit table name, typed columns, timestamps |
| New relation | Always: bidirectional, @JoinColumn on owning side, explicit FK |
| New query | Prefer Repository API; use QueryBuilder for complex joins |
| Schema change | Generate migration, review SQL, implement down() |
| Multi-entity write | Wrap in transaction (QueryRunner or callback) |
| NestJS setup | forRoot() at app level, forFeature() per module |

## Metadata

- **Category index:** `rules/_sections.md`
- **Rule template:** `rules/_template.md`
- **Total rules:** 16 across 8 categories
