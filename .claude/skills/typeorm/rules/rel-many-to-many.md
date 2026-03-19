---
title: ManyToMany Relationships
impact: HIGH
impactDescription: Missing JoinTable config leads to auto-generated table names and broken inverse navigation
tags: relationship, many-to-many, join-table, junction
---

## ManyToMany Relationships

**Impact: HIGH (missing JoinTable config causes auto-generated names and broken inverse navigation)**

ManyToMany relationships require `@JoinTable()` on the owning side with explicit table and column names.

**Incorrect (no JoinTable config, unidirectional):**

```typescript
@Entity()
export class Post {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToMany(() => Tag) // No inverse side
  @JoinTable() // Auto-generated table name — unpredictable
  tags: Tag[];
}

@Entity()
export class Tag {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;
  // Cannot navigate from Tag back to Posts
}
```

**Correct (bidirectional with explicit JoinTable configuration):**

```typescript
@Entity()
export class Post {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  title: string;

  @ManyToMany(() => Tag, (tag) => tag.posts) // Inverse side reference
  @JoinTable({
    name: "post_tags", // Explicit junction table name
    joinColumn: { name: "post_id" }, // FK to this entity
    inverseJoinColumn: { name: "tag_id" }, // FK to related entity
  })
  tags: Tag[];
}

@Entity()
export class Tag {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  name: string;

  @ManyToMany(() => Post, (post) => post.tags) // Inverse side
  posts: Post[];
}
```

**Key points:**
- `@JoinTable()` goes on **one side only** (the owning side)
- Always specify `name`, `joinColumn`, and `inverseJoinColumn` explicitly
- Define the inverse side on the related entity for bidirectional navigation
- For junction tables with extra columns, create a dedicated entity with two `@ManyToOne` relations instead of `@ManyToMany`

Reference: [TypeORM Many-to-Many](https://typeorm.io/many-to-many-relations)
