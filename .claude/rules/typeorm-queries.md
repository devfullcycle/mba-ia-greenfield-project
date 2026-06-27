---
paths:
  - 'nestjs-project/src/**/*.service.ts'
  - 'nestjs-project/src/**/*.repository.ts'
description: 'TypeORM query pitfalls — silent footguns when reading/writing through repositories'
---

# TypeORM Query Rules

These pitfalls do not raise errors. TypeORM (and PostgreSQL) accept the bad code and return wrong results, which makes the bug visible only at runtime in a downstream check.

## `null` in `where` is silently dropped

`where: { someField: null }` does **not** generate `WHERE some_field IS NULL` — it is silently removed from the query. Use the `IsNull()` helper:

```typescript
import { IsNull, Not } from 'typeorm';

repo.findOne({ where: { confirmedAt: IsNull() } });
repo.find({ where: { revokedAt: Not(IsNull()) } });
```

## PostgreSQL aborts the transaction on constraint violation

When a query inside `dataSource.transaction(...)` (or `manager.query`/`manager.save` within a transaction) raises any error, PostgreSQL puts the transaction in an **aborted** state and refuses every subsequent statement until the transaction is rolled back. A naive retry loop inside the same transaction will fail with:

```
current transaction is aborted, commands ignored until end of transaction block
```

For retry-on-collision patterns (e.g., generating a unique handle / nickname), wrap each attempt in a SAVEPOINT so only the failed attempt is rolled back:

```typescript
await dataSource.transaction(async (manager) => {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    await manager.query(`SAVEPOINT attempt_${attempt}`);
    try {
      await manager.save(entity);
      await manager.query(`RELEASE SAVEPOINT attempt_${attempt}`);
      return;
    } catch (err) {
      await manager.query(`ROLLBACK TO SAVEPOINT attempt_${attempt}`);
      if (!isUniqueViolation(err) || attempt === MAX_ATTEMPTS - 1) throw err;
      // mutate the colliding field and retry
    }
  }
});
```

## `findOne` vs `findOneOrFail`

- `findOne` returns `null` when no row matches — caller must handle the `null` and throw a domain exception if absence is an error.
- `findOneOrFail` throws TypeORM's `EntityNotFoundError` — only use it when the absence is genuinely exceptional and you do **not** want to convert it into a domain-specific exception. Prefer `findOne` + explicit domain exception in service code so error filters can map the response cleanly.

## Selecting columns excluded with `select: false`

Sensitive columns declared with `{ select: false }` (passwords, tokens) are absent from default queries. To load them in flows that legitimately need them (e.g., login):

```typescript
repo.findOne({
  where: { email },
  select: ['id', 'email', 'passwordHash'],
});
```

Or use the QueryBuilder with `.addSelect('user.passwordHash')`. Never remove `select: false` from the entity to "make it easier" — that leaks the column into every default query.
