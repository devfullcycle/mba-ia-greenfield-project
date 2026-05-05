---
paths:
  - 'nestjs-project/**/*.controller.ts'
description: 'Controller conventions — REST compliance, no silent errors, prefer exception filters over try/catch'
---

# Controller Rules

## Authentication: Default-Protected Endpoints

The application registers a JWT guard globally via `APP_GUARD`. **Every endpoint is protected by default.** Public endpoints must opt out explicitly with the `@Public()` decorator:

```typescript
import { Public } from '../auth/decorators/public.decorator';

@Public()
@Get()
list() { ... }
```

When you add a new controller anywhere in the project (videos, comments, channels, etc.), decide per-method which routes should be public and annotate them. Forgetting `@Public()` on what should be a public route causes a 401 on calls that should succeed; forgetting it on what should be authenticated is far worse — it leaks a protected endpoint.

Do not invert the convention by trying to apply the JWT guard locally — the guard is global and stays global.

For auth-domain rules (token rotation, `jti`, password reset flow, etc.) see `auth-jwt.md`.

## REST Compliance

Controllers are the HTTP layer — they must follow the REST. When editing a controller, enforce:

- Use the correct HTTP method decorator (`@Get`, `@Post`, `@Patch`, `@Delete`) matching the operation semantics
- Return the correct status code: `@HttpCode(201)` for POST, `@HttpCode(204)` for DELETE with no body
- Use plural nouns in `@Controller('resources')` — e.g., `@Controller('users')`, not `@Controller('user')`
- Nest sub-resources: `@Controller('channels/:channelId/videos')`

## Error Handling

## Never Swallow Errors

Same principle as services: controllers must never catch an error and silently return a fallback value. Errors must always result in a proper HTTP error response.

## Prefer Exception Filters Over try/catch

Controllers should not wrap calls in `try/catch`. Instead, let exceptions thrown by services propagate naturally — NestJS exception filters will catch them and return the appropriate HTTP response.

This keeps controllers thin and error handling centralized.

## Bad: try/catch in controller

```typescript
@Get(':id')
async findOne(@Param('id') id: string) {
  try {
    return await this.usersService.findById(id);
  } catch (error) {
    return { message: 'Something went wrong' }; // silent, untyped, wrong status code
  }
}
```

## Good: let exception filters handle it

```typescript
@Get(':id')
async findOne(@Param('id') id: string) {
  return this.usersService.findById(id);
  // if service throws a domain exception, the exception filter maps it to the proper HTTP response
}
```

## The Rule

- Controllers should not contain `try/catch` blocks — delegate error handling to exception filters
- Services throw domain exceptions (custom `Error` subclasses) — never NestJS HTTP exceptions. Exception filters map domain exceptions to proper HTTP responses
- If a controller-specific transformation is truly needed (rare), apply a filter at the controller or method level with `@UseFilters()` instead of inline try/catch
- Never return manually crafted error objects (`{ error: '...' }`) — always throw so the filter layer controls the response format
- Apply `ValidationPipe` globally or per-route
