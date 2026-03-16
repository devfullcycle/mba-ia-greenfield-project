---
paths:
  - 'nestjs-project/src/**/*.module.ts'
description: 'NestJS module structure conventions'
---

# NestJS Module Structure

- `@Module()` property order: `imports` → `controllers` → `providers` → `exports`
- `TypeOrmModule.forFeature([...])` goes in domain module `imports`, never in `AppModule`
- `AppModule` only contains global infrastructure (ConfigModule, TypeOrmModule) and domain modules — no business providers
- `exports` only for dependencies other modules need; don't export by default
