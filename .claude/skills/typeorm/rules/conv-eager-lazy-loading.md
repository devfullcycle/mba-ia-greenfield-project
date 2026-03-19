---
title: Eager vs Lazy Loading Conventions
impact: MEDIUM
impactDescription: Eager loading on high-cardinality relations causes massive over-fetching and memory issues
tags: convention, eager, lazy, loading, relations, performance
---

## Eager vs Lazy Loading Conventions

**Impact: MEDIUM (eager loading on high-cardinality relations causes over-fetching and memory issues)**

Prefer explicit relation loading over eager or lazy loading. Use eager only for low-cardinality, always-needed relations.

**Incorrect (eager loading on high-cardinality relation):**

```typescript
@Entity()
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  // Eager on a collection — loads ALL posts every time a user is fetched
  @OneToMany(() => Post, (post) => post.author, { eager: true })
  posts: Post[];
}
```

**Correct (explicit loading — load only what you need):**

```typescript
@Entity()
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  // No eager — relations loaded only when explicitly requested
  @OneToMany(() => Post, (post) => post.author)
  posts: Post[];
}

// Explicit loading at query time
const user = await userRepository.findOne({
  where: { id: 1 },
  relations: ["posts"], // Load posts only when needed
});
```

**Lazy loading (loads on property access):**

```typescript
@Entity()
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  // Lazy — returns a Promise, loads on access
  @OneToMany(() => Post, (post) => post.author)
  posts: Promise<Post[]>;
}

// Usage
const user = await userRepository.findOne({ where: { id: 1 } });
const posts = await user.posts; // Query fires here
```

**When to use each:**

| Strategy | Use Case | Trade-off |
|----------|----------|-----------|
| Explicit (`relations`) | Default choice | Most control, most predictable |
| Eager | Low-cardinality, always needed (e.g., user.role) | Convenient but inflexible |
| Lazy | Rarely accessed relations | Requires `Promise<>` type, risk of N+1 |

Reference: [TypeORM Eager and Lazy Relations](https://typeorm.io/eager-and-lazy-relations)
