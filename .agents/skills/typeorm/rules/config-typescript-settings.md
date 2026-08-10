---
title: TypeScript Configuration for TypeORM
impact: CRITICAL
impactDescription: Missing compiler flags cause silent decorator failures and broken entity metadata
tags: config, typescript, tsconfig, decorators
---

## TypeScript Configuration for TypeORM

**Impact: CRITICAL (missing flags cause silent decorator failures)**

TypeORM relies on TypeScript decorators and reflection metadata. Missing compiler options cause entities to silently fail at runtime.

**Incorrect (missing required flags):**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs"
  }
}
```

**Correct (all required flags for TypeORM):**

```json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "strict": true,
    "target": "ES2020",
    "module": "commonjs",
    "moduleResolution": "node",
    "strictPropertyInitialization": false
  }
}
```

**Key points:**
- `experimentalDecorators` — required for `@Entity()`, `@Column()`, etc.
- `emitDecoratorMetadata` — required for TypeORM to infer column types from TypeScript types
- `strict` — recommended for type safety across the project
- `strictPropertyInitialization: false` — necessary because entity properties are initialized by TypeORM, not in the constructor
- `target: ES2020` or higher — for modern JavaScript features

Reference: [TypeORM Installation](https://typeorm.io/#installation)
