---
title: Migration File Structure
impact: HIGH
impactDescription: Irreversible migrations block rollbacks and make incident recovery impossible
tags: migration, structure, up, down, rollback, index
---

## Migration File Structure

**Impact: HIGH (irreversible migrations block rollbacks and make incident recovery impossible)**

Every migration must implement both `up()` and `down()` methods. The `down()` must fully reverse `up()`.

**Incorrect (no down method, non-reversible):**

```typescript
export class CreateUsers1234567890 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE,
        name VARCHAR(255)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Empty — cannot rollback!
  }
}
```

**Correct (fully reversible with proper structure):**

```typescript
import { MigrationInterface, QueryRunner, Table, TableIndex } from "typeorm";

export class CreateUsers1234567890 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: "users",
        columns: [
          {
            name: "id",
            type: "int",
            isPrimary: true,
            isGenerated: true,
            generationStrategy: "increment",
          },
          {
            name: "email",
            type: "varchar",
            length: "255",
            isUnique: true,
          },
          {
            name: "name",
            type: "varchar",
            length: "255",
            isNullable: true,
          },
          {
            name: "is_active",
            type: "boolean",
            default: true,
          },
          {
            name: "created_at",
            type: "timestamp",
            default: "CURRENT_TIMESTAMP",
          },
          {
            name: "updated_at",
            type: "timestamp",
            default: "CURRENT_TIMESTAMP",
            onUpdate: "CURRENT_TIMESTAMP",
          },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      "users",
      new TableIndex({
        name: "IDX_USERS_EMAIL",
        columnNames: ["email"],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex("users", "IDX_USERS_EMAIL");
    await queryRunner.dropTable("users");
  }
}
```

**Key points:**
- Always implement `down()` — it must fully reverse `up()`
- Drop indexes before dropping tables in `down()`
- Use TypeORM's `Table`, `TableIndex`, `TableColumn` APIs — they're database-agnostic
- Use raw SQL (`queryRunner.query()`) only when the schema builder API doesn't support your operation
- Name indexes explicitly (e.g., `IDX_USERS_EMAIL`) for predictable rollbacks

Reference: [TypeORM Migrations](https://typeorm.io/migrations)
