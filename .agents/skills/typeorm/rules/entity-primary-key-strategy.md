---
title: Primary Key Strategy
impact: CRITICAL
impactDescription: Wrong PK strategy causes performance issues, collision risks, or migration headaches
tags: entity, primary-key, uuid, auto-increment, composite
---

## Primary Key Strategy

**Impact: CRITICAL (wrong PK strategy causes performance or collision issues)**

Choose the right primary key strategy based on the use case. Each has trade-offs for performance, distribution, and security.

**Incorrect (always using auto-increment without considering context):**

```typescript
// Using auto-increment for a distributed system — collision risk
@PrimaryGeneratedColumn()
id: number;

// Exposing sequential IDs in a public API — security concern (enumerable)
@PrimaryGeneratedColumn()
id: number;
```

**Correct (choose PK strategy by context):**

```typescript
// Auto-increment — best for internal IDs, simple schemas, joins performance
@PrimaryGeneratedColumn()
id: number;

// UUID — best for distributed systems, public-facing IDs, API resources
@PrimaryGeneratedColumn("uuid")
id: string;

// Custom primary key — when the PK is a natural/business key
@PrimaryColumn()
id: string;

// Composite primary key — for junction/association tables
@Entity()
export class OrderItem {
  @PrimaryColumn()
  orderId: number;

  @PrimaryColumn()
  productId: number;
}
```

**When to use each:**

| Strategy | Use Case | Pros | Cons |
|----------|----------|------|------|
| Auto-increment | Internal, single-DB | Fast joins, small index | Enumerable, no distribution |
| UUID | Public APIs, distributed | Non-enumerable, globally unique | Larger index, slower joins |
| Custom PK | Natural keys | Meaningful, no surrogate | Immutability required |
| Composite PK | Junction tables | No surrogate column | Complex queries |

Reference: [TypeORM Primary Columns](https://typeorm.io/entities#primary-columns)
