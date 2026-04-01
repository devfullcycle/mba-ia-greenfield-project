> Part of the `testing-guide-nestjs-project` skill (see `../SKILL.md`).

# Entities (`*.entity.ts`)

## What to test

- **Unique constraints** — inserting duplicate values on unique columns must throw
- **Not-null constraints** — inserting without required columns must throw
- **Default values** — `@CreateDateColumn()`, `@UpdateDateColumn()`, default column values populate correctly
- **`select: false` fields** — sensitive fields (passwords, tokens) are excluded from default `find` queries
- **Cascade behavior** — `cascade: true` on relations propagates saves/deletes as expected
- **Enum columns** — inserting invalid enum values is rejected by the database
- **Relation integrity** — foreign key constraints prevent orphaned records; `onDelete` behavior works
- **Column type mapping** — `jsonb`, `text[]`, and other non-trivial PostgreSQL types store/retrieve correctly

## Layer assignment

| Scenario | Layer | Why |
|---|---|---|
| Any entity with constraints, defaults, or `select: false` | **Integration** (real DB) | Constraints are enforced by PostgreSQL, not TypeORM — only a real DB proves they work |
| Entity with only basic columns, no constraints | **Skip** | Static field existence is not worth testing; TypeORM maps it automatically |

Entities are **never** tested at the unit layer — they have no logic, only structure that must be validated against the real database.

## Setup pattern

```typescript
// user.entity.integration.spec.ts
import { DataSource, Repository } from 'typeorm';
import { User } from './user.entity';

describe('User entity (integration)', () => {
  let dataSource: DataSource;
  let userRepository: Repository<User>;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      host: process.env.DB_HOST ?? 'localhost',
      port: Number(process.env.DB_PORT ?? 5432),
      username: process.env.DB_USERNAME ?? 'streamtube',
      password: process.env.DB_PASSWORD ?? 'streamtube',
      database: process.env.DB_DATABASE ?? 'streamtube',
      entities: [User],
      synchronize: true, // OK for test setup — creates tables
    });
    await dataSource.initialize();
    userRepository = dataSource.getRepository(User);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM "users"');
  });

  it('should auto-generate uuid, createdAt, and updatedAt', async () => {
    const user = userRepository.create({ email: 'test@example.com', password: 'hashed' });
    const saved = await userRepository.save(user);

    expect(saved.id).toBeDefined();
    expect(saved.createdAt).toBeInstanceOf(Date);
    expect(saved.updatedAt).toBeInstanceOf(Date);
  });

  it('should enforce unique email constraint', async () => {
    await userRepository.save(
      userRepository.create({ email: 'dup@example.com', password: 'hashed' }),
    );

    await expect(
      userRepository.save(
        userRepository.create({ email: 'dup@example.com', password: 'other' }),
      ),
    ).rejects.toThrow(); // PostgreSQL unique violation
  });

  it('should exclude password from default select', async () => {
    await userRepository.save(
      userRepository.create({ email: 'test@example.com', password: 'secret' }),
    );

    const found = await userRepository.findOneBy({ email: 'test@example.com' });
    expect(found?.password).toBeUndefined();
  });
});
```

**Key points:**
- Use a real PostgreSQL connection (the Docker `db` service)
- Use `synchronize: true` in test setup to auto-create tables from entities
- Clean up with `dataSource.query('DELETE FROM "table"')` — not `repository.delete({})`
- Test constraints by attempting violations and expecting rejections
- Test `select: false` by querying without explicit select and asserting the field is absent

## When to skip

- Entities with only basic columns (`id`, `name`, `createdAt`) and no unique constraints, no `select: false`, no cascades — these are static structure that TypeORM maps automatically
- Do NOT test that a column exists or has a specific type — that's static structure assertion

## Examples from project

The project currently has no entities. When entities are created (per project plan: User, Channel, Video, Comment, Like, Subscription), each will need integration tests for:
- User: unique email, `select: false` on password, `@CreateDateColumn`
- Channel: unique slug/name, foreign key to User, cascade behavior
- Video: unique URL slug, enum for visibility/status, foreign key to Channel
- Comment: nested comments (self-referencing relation), foreign key to Video and User
- Like: unique compound constraint (user + video), foreign key integrity
- Subscription: unique compound constraint (subscriber + channel)
