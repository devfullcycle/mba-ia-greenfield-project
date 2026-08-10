---
title: Define Proper Entity Structure
impact: CRITICAL
impactDescription: Poorly structured entities lead to schema drift, missing audit fields, and unclear table mappings
tags: entity, structure, table, timestamps, decorators
---

## Define Proper Entity Structure

**Impact: CRITICAL (poorly structured entities cause schema drift and missing audit trails)**

Every entity must have an explicit table name, typed columns, and timestamp columns for auditing.

**Incorrect (no table name, no timestamps, loose column types):**

```typescript
import { Entity, PrimaryGeneratedColumn, Column } from "typeorm";

@Entity() // No explicit table name — relies on class name
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column() // No type specified — inferred, may vary by database
  email: string;

  @Column()
  name: string;

  @Column()
  isActive: boolean;
  // No audit timestamps
}
```

**Correct (explicit table name, typed columns, timestamps):**

```typescript
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity("users") // Explicit table name
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: "varchar", length: 255, unique: true })
  email: string;

  @Column({ type: "varchar", length: 255, nullable: true })
  name: string | null;

  @Column({ type: "boolean", default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
```

**Key points:**
- Always pass an explicit table name to `@Entity("table_name")`
- Specify `type` on every `@Column()` — do not rely on type inference
- Use `nullable: true` and type union (`string | null`) together for nullable columns
- Include `@CreateDateColumn()` and `@UpdateDateColumn()` for auditing
- Set sensible defaults with `default` option

Reference: [TypeORM Entities](https://typeorm.io/entities)
