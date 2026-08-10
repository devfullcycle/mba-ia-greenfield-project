---
title: NestJS TypeORM Integration
impact: MEDIUM
impactDescription: Manual TypeORM setup in NestJS bypasses dependency injection and breaks testability
tags: integration, nestjs, module, forRoot, forFeature, inject-repository
---

## NestJS TypeORM Integration

**Impact: MEDIUM (manual setup bypasses DI and breaks testability)**

Use `@nestjs/typeorm` module with `forRoot()` and `forFeature()` — never manually instantiate DataSource or repositories in NestJS.

**Incorrect (manual DataSource and repository instantiation):**

```typescript
// Bypasses NestJS DI — cannot mock in tests, no lifecycle management
import { AppDataSource } from "./data-source";
import { User } from "./entities/user.entity";

@Injectable()
export class UsersService {
  private usersRepository = AppDataSource.getRepository(User);

  findAll() {
    return this.usersRepository.find();
  }
}
```

**Correct (NestJS TypeORM module integration):**

```typescript
// app.module.ts — root configuration
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { User } from "./entities/user.entity";
import { UsersModule } from "./users/users.module";

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: "postgres",
      host: process.env.DB_HOST || "localhost",
      port: parseInt(process.env.DB_PORT || "5432"),
      username: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      entities: [User],
      synchronize: false,
    }),
    UsersModule,
  ],
})
export class AppModule {}

// users/users.module.ts — feature module registers entities
@Module({
  imports: [TypeOrmModule.forFeature([User])],
  providers: [UsersService],
  controllers: [UsersController],
})
export class UsersModule {}

// users/users.service.ts — inject repository via DI
@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
  ) {}

  findAll(): Promise<User[]> {
    return this.usersRepository.find();
  }

  findOne(id: number): Promise<User | null> {
    return this.usersRepository.findOneBy({ id });
  }
}
```

**Key points:**
- `TypeOrmModule.forRoot()` — configures the DataSource once at the app level
- `TypeOrmModule.forFeature([Entity])` — registers entities per feature module
- `@InjectRepository(Entity)` — injects the repository via NestJS DI
- Use `ConfigModule` with `forRootAsync()` for environment-based configuration
- In tests, override the repository with `module.get()` or `createMock()`

Reference: [NestJS TypeORM](https://docs.nestjs.com/techniques/database)
