---
paths:
  - 'nestjs-project/**/*.service.ts'
description: 'Service layer error handling — errors must always propagate to upper layers'
---

# Service Error Handling Rules

## Never Swallow Errors

Services must never catch an error and silently ignore it. Every error must either:
1. **Propagate naturally** — don't catch it at all, let it bubble up
2. **Be re-thrown** — catch to add context or transform, then re-throw

A `try/catch` that logs and returns `null`, `undefined`, `false`, or an empty value instead of throwing is a silent failure. This hides bugs and makes debugging extremely difficult.

## Bad: swallowing the error

```typescript
async findById(id: string): Promise<User | null> {
  try {
    return await this.userRepository.findOneByOrFail({ id });
  } catch (error) {
    this.logger.error('User not found', error);
    return null; // caller has no idea something went wrong
  }
}
```

## Good: let it propagate or re-throw with context

```typescript
async findById(id: string): Promise<User> {
  const user = await this.userRepository.findOneBy({ id });
  if (!user) {
    throw new NotFoundException(`User ${id} not found`);
  }
  return user;
}
```

## Good: catch, enrich, re-throw

```typescript
async createChannel(dto: CreateChannelDto): Promise<Channel> {
  try {
    return await this.channelRepository.save(dto);
  } catch (error) {
    if (error.code === '23505') {
      throw new ConflictException('Channel name already exists');
    }
    throw error; // unknown errors propagate as-is
  }
}
```

## The Rule

- `catch` blocks must always end with a `throw` — either the original error or a more specific one
- The only exception is when the catch is intentionally converting an error into a valid domain result (e.g., `findOneBy` returning `null` is not an error — a `try/catch` that swallows `findOneByOrFail` is)
- Use NestJS built-in exceptions (`NotFoundException`, `ConflictException`, `BadRequestException`, etc.) so the exception filter layer can map them to proper HTTP responses
- Logging inside a catch is fine, but logging is not a substitute for throwing
