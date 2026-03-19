---
title: DataSource Configuration Setup
impact: CRITICAL
impactDescription: Misconfigured DataSource causes connection failures, security issues, or data loss in production
tags: config, datasource, connection, pool, ssl
---

## DataSource Configuration Setup

**Impact: CRITICAL (misconfigured connections cause outages or security breaches)**

The DataSource is the entry point for TypeORM. It must be configured with environment variables, connection pooling, and SSL for production.

**Incorrect (hardcoded credentials, no pooling, no SSL):**

```typescript
import { DataSource } from "typeorm";

export const AppDataSource = new DataSource({
  type: "postgres",
  host: "localhost",
  port: 5432,
  username: "admin",
  password: "secret123",
  database: "mydb",
  entities: ["src/entities/**/*.ts"],
  synchronize: true, // DANGEROUS in production
});
```

**Correct (env-based config with pool and SSL):**

```typescript
// data-source.ts
import { DataSource } from "typeorm";
import { User } from "./entities/User";
import { Post } from "./entities/Post";

export const AppDataSource = new DataSource({
  type: "postgres",
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5432"),
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,

  // Entity configuration — prefer explicit imports over globs
  entities: [User, Post],
  // Or use glob pattern: entities: ["src/entities/**/*.ts"]

  // Migrations
  migrations: ["src/migrations/**/*.ts"],

  // NEVER use synchronize in production
  synchronize: false,

  // Logging — enable in development only
  logging: process.env.NODE_ENV === "development",

  // Connection pool
  poolSize: 10,

  // SSL for production
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
});

// Initialize connection
AppDataSource.initialize()
  .then(() => console.log("Data Source initialized"))
  .catch((error) => console.error("Error initializing Data Source:", error));
```

**Key points:**
- Always use environment variables for credentials
- Set `synchronize: false` — use migrations instead
- Configure connection pooling (`poolSize`)
- Enable SSL in production environments
- Prefer explicit entity imports over glob patterns for type safety

Reference: [TypeORM DataSource](https://typeorm.io/data-source)
