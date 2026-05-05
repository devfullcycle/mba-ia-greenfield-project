---
paths:
  - 'nestjs-project/**/migrations/**'
  - 'nestjs-project/**/*data-source.ts'
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

- Never use `synchronize: true` in any environment — migrations are the only sanctioned way to change the schema
- Test migrations against a fresh database before considering them done
- Migrations must be idempotent where possible — use `IF EXISTS` / `IF NOT EXISTS` guards for DDL

## Recovering from `synchronize` Residue

If you find entities in `src/` whose tables already exist in the database but have **no corresponding migration file on disk**, the database was previously populated by `synchronize: true` (or by a deleted migration). Do **not** try to "patch" the schema with a new migration on top — the generated diff will be empty and TypeORM will think everything is fine while the migration table is wrong.

Correct recovery:

1. Drop the orphan tables in the dev database (`DROP TABLE ... CASCADE`).
2. Clear the `migrations` table if it has stale rows.
3. Run `typeorm migration:generate` against the empty database — it will now produce a complete `CREATE TABLE` migration that matches the entities.
4. Run the new migration to recreate the tables cleanly.

## Migration Tests Must Restore DB State

Any test that exercises the migration runner (`runMigrations` / `undoLastMigration`) leaves the database in a non-default state. Other suites in the same Jest run will see missing tables and fail mysteriously.

Always restore the schema in `afterAll`:

```typescript
afterAll(async () => {
  await dataSource.runMigrations(); // re-apply everything that was undone
  await dataSource.destroy();
});
```

## Importing Migrations in Tests

`ts-jest` does not reliably resolve TypeORM's glob patterns (`migrations: ['dist/migrations/*.js']`) inside the Jest sandbox. For a test `DataSource`, **import the migration classes directly** and pass them as an array:

```typescript
import { CreateUsersAndChannels1775687773260 } from '../src/database/migrations/1775687773260-CreateUsersAndChannels';

new DataSource({
  // ...
  migrations: [CreateUsersAndChannels1775687773260, CreateAuthTokens1777579850478],
});
```

The runtime `data-source.ts` can keep the glob — only test data sources need explicit imports.

## Test DataSource Entity Arrays

When constructing a `DataSource` for tests, pass entity classes explicitly — do **not** use glob strings:

```typescript
new DataSource({
  // ...
  entities: [User, Channel, RefreshToken, VerificationToken],
});
```

Glob entries (`'src/**/*.entity.ts'`) work in production via `ts-node` but break in `ts-jest` — explicit class arrays are the only reliable form in test data sources. The runtime `data-source.ts` can keep the glob.

For TypeORM **query** pitfalls (`IsNull`, transactions, SAVEPOINT) that apply in service code, see `typeorm-queries.md`.
