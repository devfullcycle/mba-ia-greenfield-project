---
title: Indexes, Naming Strategy, and Cascades
impact: MEDIUM
impactDescription: Missing indexes cause slow queries; inconsistent naming causes confusion between TypeScript and SQL
tags: convention, index, naming-strategy, cascade, snake-case
---

## Indexes, Naming Strategy, and Cascades

**Impact: MEDIUM (missing indexes cause slow queries; inconsistent naming causes confusion)**

### Indexes

Add indexes on columns used in WHERE clauses, JOIN conditions, and ORDER BY.

**Incorrect (no indexes on frequently queried columns):**

```typescript
@Entity()
export class User {
  @Column()
  email: string; // Queried constantly — no index

  @Column()
  firstName: string;

  @Column()
  lastName: string;
}
```

**Correct (indexed columns):**

```typescript
@Entity()
@Index(["firstName", "lastName"]) // Composite index for name searches
export class User {
  @Column()
  @Index() // Single-column index
  email: string;

  @Column()
  firstName: string;

  @Column()
  lastName: string;
}
```

### Cascade Operations

Use cascades carefully — they auto-save/remove related entities.

```typescript
@OneToMany(() => Post, (post) => post.author, {
  cascade: true, // TypeORM-level: saves/removes related posts when saving user
  onDelete: "CASCADE", // Database-level: deletes posts when user row is deleted
})
posts: Post[];
```

**Key points on cascades:**
- `cascade: true` — TypeORM propagates `save()` / `remove()` to related entities
- `onDelete: "CASCADE"` — database FK constraint handles deletion
- Use both together for consistency, or prefer database-level cascades for safety

### Naming Strategy

Use a snake_case naming strategy for consistent mapping between camelCase TypeScript and snake_case SQL.

```typescript
import { DefaultNamingStrategy, NamingStrategyInterface } from "typeorm";
import { snakeCase } from "typeorm/util/StringUtils";

export class SnakeNamingStrategy
  extends DefaultNamingStrategy
  implements NamingStrategyInterface
{
  tableName(
    targetName: string,
    userSpecifiedName: string | undefined,
  ): string {
    return userSpecifiedName ? userSpecifiedName : snakeCase(targetName);
  }

  columnName(
    propertyName: string,
    customName: string,
    embeddedPrefixes: string[],
  ): string {
    return (
      snakeCase(embeddedPrefixes.join("_")) +
      (customName ? customName : snakeCase(propertyName))
    );
  }
}

// Use in DataSource config
namingStrategy: new SnakeNamingStrategy(),
```

**Key points:**
- Add indexes on columns used in `WHERE`, `JOIN`, and `ORDER BY`
- Name indexes explicitly in migrations (e.g., `IDX_USERS_EMAIL`)
- Use `SnakeNamingStrategy` to auto-convert camelCase properties to snake_case columns
- Prefer database-level `onDelete` over TypeORM `cascade` for deletion safety

Reference: [TypeORM Indices](https://typeorm.io/indices) | [TypeORM Naming Strategy](https://typeorm.io/naming-strategy)
