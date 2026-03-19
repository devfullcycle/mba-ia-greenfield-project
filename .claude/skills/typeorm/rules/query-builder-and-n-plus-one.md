---
title: QueryBuilder and N+1 Prevention
impact: HIGH
impactDescription: Unoptimized queries and N+1 patterns cause severe performance degradation under load
tags: query, query-builder, n-plus-one, performance, joins, pagination
---

## QueryBuilder and N+1 Prevention

**Impact: HIGH (N+1 queries and unoptimized patterns cause severe performance degradation)**

Use QueryBuilder for complex queries. Always load relations eagerly when iterating over collections to avoid N+1.

### QueryBuilder Usage

```typescript
// Select with joins, filtering, and pagination
const users = await userRepository
  .createQueryBuilder("user")
  .leftJoinAndSelect("user.posts", "post")
  .where("user.isActive = :isActive", { isActive: true })
  .andWhere("post.publishedAt IS NOT NULL")
  .orderBy("user.createdAt", "DESC")
  .skip(0)
  .take(10)
  .getMany();

// Aggregation with raw results
const result = await userRepository
  .createQueryBuilder("user")
  .select("COUNT(*)", "count")
  .where("user.isActive = :isActive", { isActive: true })
  .getRawOne();

// Bulk insert
await userRepository
  .createQueryBuilder()
  .insert()
  .into(User)
  .values([
    { email: "user1@example.com", name: "User 1" },
    { email: "user2@example.com", name: "User 2" },
  ])
  .execute();
```

### N+1 Problem

**Incorrect (N+1 — one query per user for their posts):**

```typescript
const users = await userRepository.find();
for (const user of users) {
  // Each access triggers a separate query — N+1 problem
  console.log(user.posts);
}
```

**Correct (eager load relations in a single query):**

```typescript
// Option 1: Using find with relations
const users = await userRepository.find({
  relations: ["posts"],
});

// Option 2: Using QueryBuilder with join
const users = await userRepository
  .createQueryBuilder("user")
  .leftJoinAndSelect("user.posts", "post")
  .getMany();
```

**Key points:**
- Always use parameterized queries (`:param`) — never string interpolation
- Use `leftJoinAndSelect` to load relations in a single query
- Use `skip()` / `take()` for pagination (not `offset` / `limit` which behave differently with joins)
- Use `getRawOne()` / `getRawMany()` for aggregations
- When iterating a collection that accesses relations, load them upfront with `relations` or `leftJoinAndSelect`

Reference: [TypeORM QueryBuilder](https://typeorm.io/select-query-builder)
