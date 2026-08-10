---
title: Use Domain Exceptions in Services
impact: HIGH
impactDescription: Keeps services transport-agnostic and controllers thin
tags: error-handling, exceptions, services, domain-exceptions
---

## Use Domain Exceptions in Services

Services must not throw NestJS HTTP exceptions (`NotFoundException`, `ConflictException`, etc.) — these are transport-layer concerns. Instead, throw domain exceptions (custom `Error` subclasses) that describe what went wrong in business terms. Exception filters are responsible for mapping domain exceptions to HTTP responses.

**Incorrect (return error objects instead of throwing):**

```typescript
// Return error objects instead of throwing
@Injectable()
export class UsersService {
  async findById(id: string): Promise<{ user?: User; error?: string }> {
    const user = await this.repo.findOne({ where: { id } });
    if (!user) {
      return { error: 'User not found' }; // Controller must check this
    }
    return { user };
  }
}

@Controller('users')
export class UsersController {
  @Get(':id')
  async findOne(@Param('id') id: string) {
    const result = await this.usersService.findById(id);
    if (result.error) {
      throw new NotFoundException(result.error);
    }
    return result.user;
  }
}
```

**Incorrect (throwing HTTP exceptions from services):**

```typescript
// HTTP exceptions in services — couples service to transport layer
@Injectable()
export class UsersService {
  async findById(id: string): Promise<User> {
    const user = await this.repo.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException(`User #${id} not found`);
      // NotFoundException is an HTTP concept — services should not know about HTTP
    }
    return user;
  }

  async create(dto: CreateUserDto): Promise<User> {
    const existing = await this.repo.findOne({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictException('Email already registered');
      // ConflictException (409) is HTTP — not a domain concept
    }
    return this.repo.save(dto);
  }
}
```

**Correct (domain exceptions + exception filters):**

```typescript
// Domain exceptions — describe what went wrong in business terms
export class EntityNotFoundException extends Error {
  constructor(
    public readonly entity: string,
    public readonly id: string,
  ) {
    super(`${entity} with ID "${id}" not found`);
  }
}

export class DuplicateEntityException extends Error {
  constructor(
    public readonly entity: string,
    public readonly field: string,
  ) {
    super(`${entity} with duplicate ${field}`);
  }
}

// Service throws domain exceptions — no HTTP awareness
@Injectable()
export class UsersService {
  constructor(private readonly repo: UserRepository) {}

  async findById(id: string): Promise<User> {
    const user = await this.repo.findOne({ where: { id } });
    if (!user) {
      throw new EntityNotFoundException('User', id);
    }
    return user;
  }

  async create(dto: CreateUserDto): Promise<User> {
    const existing = await this.repo.findOne({ where: { email: dto.email } });
    if (existing) {
      throw new DuplicateEntityException('User', 'email');
    }
    return this.repo.save(dto);
  }

  async update(id: string, dto: UpdateUserDto): Promise<User> {
    const user = await this.findById(id); // Throws if not found
    Object.assign(user, dto);
    return this.repo.save(user);
  }
}

// Controller stays thin — no error handling
@Controller('users')
export class UsersController {
  @Get(':id')
  findOne(@Param('id') id: string): Promise<User> {
    return this.usersService.findById(id);
  }

  @Post()
  create(@Body() dto: CreateUserDto): Promise<User> {
    return this.usersService.create(dto);
  }
}

// Exception filters map domain exceptions to HTTP responses
@Catch(EntityNotFoundException)
export class EntityNotFoundFilter implements ExceptionFilter {
  catch(exception: EntityNotFoundException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    response.status(404).json({
      statusCode: 404,
      message: exception.message,
      entity: exception.entity,
      id: exception.id,
    });
  }
}

@Catch(DuplicateEntityException)
export class DuplicateEntityFilter implements ExceptionFilter {
  catch(exception: DuplicateEntityException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    response.status(409).json({
      statusCode: 409,
      message: exception.message,
      entity: exception.entity,
      field: exception.field,
    });
  }
}

// Register globally in main.ts
app.useGlobalFilters(
  new EntityNotFoundFilter(),
  new DuplicateEntityFilter(),
);
```

Reference: [NestJS Exception Filters](https://docs.nestjs.com/exception-filters)
