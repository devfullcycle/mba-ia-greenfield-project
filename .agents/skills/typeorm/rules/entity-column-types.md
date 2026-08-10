---
title: Column Types and Decorators
impact: CRITICAL
impactDescription: Untyped columns cause silent type mismatches and database-specific bugs
tags: entity, column, types, enum, json, soft-delete, version
---

## Column Types and Decorators

**Impact: CRITICAL (untyped columns cause silent type mismatches across databases)**

Always specify explicit column types. TypeORM's type inference varies by database driver and can produce unexpected schema differences.

**Incorrect (relying on type inference):**

```typescript
@Entity()
export class Product {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string; // Inferred as varchar(255) on some DBs, text on others

  @Column()
  price: number; // int? float? decimal? Depends on DB

  @Column()
  isAvailable: boolean; // boolean? tinyint? Depends on DB

  @Column()
  metadata: object; // No json/jsonb specification
}
```

**Correct (explicit types for all columns):**

```typescript
@Entity()
export class Product {
  @PrimaryGeneratedColumn()
  id: number;

  // String columns — always specify length
  @Column({ type: "varchar", length: 255 })
  name: string;

  @Column({ type: "text", nullable: true })
  description: string | null;

  // Numeric columns — specify precision for decimals
  @Column({ type: "decimal", precision: 10, scale: 2 })
  price: number;

  @Column({ type: "int", default: 0 })
  stock: number;

  // Boolean
  @Column({ type: "boolean", default: true })
  isAvailable: boolean;

  // JSON — use "jsonb" for PostgreSQL (indexed), "json" for MySQL
  @Column({ type: "jsonb", nullable: true })
  metadata: Record<string, any> | null;

  // Enum — define allowed values explicitly
  @Column({
    type: "enum",
    enum: ["active", "inactive", "pending"],
    default: "pending",
  })
  status: "active" | "inactive" | "pending";

  // Timestamps
  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  // Soft delete — marks row as deleted without removing it
  @DeleteDateColumn()
  deletedAt: Date | null;

  // Optimistic locking — auto-incremented on each save
  @VersionColumn()
  version: number;
}
```

**Key points:**
- Always specify `type` — never rely on inference
- Use `varchar` with `length` for bounded strings, `text` for unbounded
- Use `decimal` with `precision` and `scale` for monetary values
- Use `jsonb` (PostgreSQL) for indexed JSON, `json` for MySQL
- Use `@DeleteDateColumn()` for soft deletes (works with `softDelete()` / `softRemove()`)
- Use `@VersionColumn()` for optimistic locking in concurrent environments

Reference: [TypeORM Column Types](https://typeorm.io/entities#column-types)
