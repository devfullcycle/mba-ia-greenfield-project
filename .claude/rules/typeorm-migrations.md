---
paths:
  - 'nestjs-project/**/migrations/**'
description: 'Database migration safety rules'
---

# Migration Rules

## Immutability

- Never edit a migration that has already been executed — create a new one instead
- If a migration needs to be reverted, write a new migration that undoes the change

## Generation

- Always generate migrations via TypeORM CLI (`typeorm migration:generate` or `typeorm migration:create`)
- Never write migration SQL by hand unless the CLI cannot express the change (e.g., data migrations)

## Safety

- Never use `synchronize: true` in production — migrations are the only way to change the schema
- Test migrations against a fresh database before considering them done
- Migrations must be idempotent where possible — use `IF EXISTS` / `IF NOT EXISTS` guards for DDL
