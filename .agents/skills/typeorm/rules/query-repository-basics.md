---
title: Repository Basics
impact: HIGH
impactDescription: Raw queries or incorrect repository usage bypasses TypeORM safety and creates SQL injection risks
tags: query, repository, find, save, create, delete, soft-delete
---

## Repository Basics

**Impact: HIGH (raw queries bypass TypeORM safety and create SQL injection risks)**

Use the Repository API for all standard CRUD operations. Prefer `create()` + `save()` over direct object instantiation.

**Incorrect (raw queries for simple operations):**

```typescript
// Raw SQL for a simple find — no type safety, injection risk
const users = await dataSource.query("SELECT * FROM users WHERE is_active = true");

// Direct instantiation — skips entity listeners and subscribers
const user = new User();
user.email = "user@example.com";
await userRepository.save(user);
```

**Correct (Repository API with proper patterns):**

```typescript
import { AppDataSource } from "./data-source";
import { User } from "./entities/User";

const userRepository = AppDataSource.getRepository(User);

// Find all
const users = await userRepository.find();

// Find with conditions
const activeUsers = await userRepository.find({
  where: { isActive: true },
});

// Find one
const user = await userRepository.findOne({
  where: { id: 1 },
});

// Find or fail — throws EntityNotFoundError
const user = await userRepository.findOneOrFail({
  where: { id: 1 },
});

// Create + Save — triggers entity listeners
const newUser = userRepository.create({
  email: "user@example.com",
  name: "John Doe",
});
await userRepository.save(newUser);

// Update
await userRepository.update({ id: 1 }, { name: "Jane Doe" });

// Delete
await userRepository.delete({ id: 1 });

// Soft delete (requires @DeleteDateColumn on entity)
await userRepository.softDelete({ id: 1 });
```

**Key points:**
- Use `create()` to instantiate entities — it respects defaults and listeners
- Use `save()` for inserts and updates (upserts based on PK presence)
- Use `findOneOrFail()` when the entity must exist
- Use `softDelete()` with `@DeleteDateColumn()` for soft deletes
- Never use raw `query()` for standard CRUD — it bypasses type safety

Reference: [TypeORM Repository API](https://typeorm.io/repository-api)
