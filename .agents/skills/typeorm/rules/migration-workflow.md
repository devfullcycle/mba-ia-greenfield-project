---
title: Migration Workflow
impact: HIGH
impactDescription: Using synchronize in production causes data loss; skipping migrations leads to schema drift
tags: migration, cli, synchronize, production, workflow
---

## Migration Workflow

**Impact: HIGH (synchronize in production causes data loss; skipping migrations leads to schema drift)**

Always use migrations for schema changes. Never use `synchronize: true` in production.

**Incorrect (using synchronize instead of migrations):**

```typescript
// data-source.ts
export const AppDataSource = new DataSource({
  // ...
  synchronize: true, // DANGEROUS: drops columns/tables to match entities
});
```

**Correct (migration-based workflow):**

```typescript
// data-source.ts
export const AppDataSource = new DataSource({
  // ...
  synchronize: process.env.NODE_ENV === 'development', // true in dev, false in production
  migrations: ["src/migrations/**/*.ts"],
});
```

### CLI Commands

```bash
# Generate migration from entity changes (compares entities vs current schema)
npx typeorm migration:generate src/migrations/CreateUsers -d src/data-source.ts

# Create empty migration (for custom SQL, seeds, data migrations)
npx typeorm migration:create src/migrations/SeedUsers

# Run pending migrations
npx typeorm migration:run -d src/data-source.ts

# Revert last migration
npx typeorm migration:revert -d src/data-source.ts
```

### Workflow

1. Modify entity (add/change columns, relations)
2. Run `migration:generate` to auto-generate the migration
3. Review the generated SQL — never blindly run generated migrations
4. Run `migration:run` to apply
5. Commit both the entity change and the migration file together

**Key points:**
- `synchronize: false` in production — enforced via config validation (e.g., Joi schema in `ConfigModule.forRoot()`)
- `synchronize: true` is acceptable in development for convenience, as it auto-syncs schema without running migrations
- Use NestJS `ConfigModule` with validation to guarantee `synchronize` is never `true` in production:
  ```typescript
  ConfigModule.forRoot({
    validationSchema: Joi.object({
      NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
      DB_SYNCHRONIZE: Joi.when('NODE_ENV', {
        is: 'production',
        then: Joi.boolean().valid(false).default(false),
        otherwise: Joi.boolean().default(true),
      }),
    }),
  })
  ```
- Use `migration:generate` for schema changes, `migration:create` for data/seed migrations
- Always review generated migrations before running them
- Commit entity changes and migration files in the same commit
- In CI/CD, run `migration:run` as part of the deployment pipeline

Reference: [TypeORM Migrations](https://typeorm.io/migrations)
