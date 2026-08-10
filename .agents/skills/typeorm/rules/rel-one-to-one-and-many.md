---
title: OneToOne and OneToMany/ManyToOne Relationships
impact: HIGH
impactDescription: Missing inverse sides or JoinColumn causes broken queries and orphaned foreign keys
tags: relationship, one-to-one, one-to-many, many-to-one, join-column, foreign-key
---

## OneToOne and OneToMany/ManyToOne Relationships

**Impact: HIGH (missing inverse sides or JoinColumn breaks queries and causes orphaned FKs)**

Relationships must always be bidirectional with explicit inverse sides, `@JoinColumn()` on the owning side, and explicit FK columns for ManyToOne.

### One-to-One

**Incorrect (unidirectional, no inverse side):**

```typescript
@Entity()
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @OneToOne(() => Profile) // No inverse side
  @JoinColumn()
  profile: Profile;
}

@Entity()
export class Profile {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  bio: string;
  // Cannot navigate from Profile back to User
}
```

**Correct (bidirectional with cascade):**

```typescript
@Entity()
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @OneToOne(() => Profile, (profile) => profile.user, { cascade: true })
  @JoinColumn() // Owning side — creates the FK column
  profile: Profile;
}

@Entity()
export class Profile {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  bio: string;

  @OneToOne(() => User, (user) => user.profile) // Inverse side
  user: User;
}
```

### One-to-Many / Many-to-One

**Incorrect (no inverse, no explicit FK column, no onDelete):**

```typescript
@Entity()
export class Post {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => User)
  author: User;
  // No explicit FK column — can't query by authorId without joining
  // No onDelete — orphaned posts if user is deleted
}
```

**Correct (bidirectional with explicit FK and onDelete):**

```typescript
@Entity()
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @OneToMany(() => Post, (post) => post.author) // Inverse side
  posts: Post[];
}

@Entity()
export class Post {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  title: string;

  @ManyToOne(() => User, (user) => user.posts, { onDelete: "CASCADE" })
  @JoinColumn({ name: "author_id" }) // Explicit FK column name
  author: User;

  @Column()
  authorId: number; // Explicit FK property — enables querying without joins
}
```

**Key points:**
- `@JoinColumn()` goes on the **owning side** (the side with the FK column)
- Always define the **inverse side** for bidirectional navigation
- Use `onDelete: "CASCADE"` or `"SET NULL"` to handle parent deletion
- Add explicit FK properties (`authorId`) for efficient queries without joins

Reference: [TypeORM Relations](https://typeorm.io/relations)
