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

## OpenAPI Documentation

Every controller must be documented with `@nestjs/swagger` decorators. A PR that adds or modifies an endpoint without OpenAPI annotations is incomplete — the exported `openapi.json` is the contract consumed by the Next.js frontend, and an undocumented endpoint silently degrades it.

### At the class level

Annotate the controller with `@ApiTags('resource')`, using the same plural noun as `@Controller(...)`:

```typescript
@ApiTags('auth')
@Controller('auth')
export class AuthController { ... }
```

### At the method level

Each handler must declare:

- `@ApiOperation({ summary, description })` — short `summary`, `description` explaining the effect of the call.
- One `@ApiResponse` for the success status (with `schema` when there is a body).
- One `@ApiResponse` for **each** predictable error status the endpoint can produce (400, 401, 403, 404, 409, …).

```typescript
@Post('register')
@ApiOperation({
  summary: 'Register a new user',
  description: 'Creates a new user account and sends an email confirmation link.',
})
@ApiResponse({
  status: 201,
  description: 'User registered successfully',
  schema: {
    properties: {
      id: { type: 'string', format: 'uuid' },
      email: { type: 'string', format: 'email' },
    },
  },
})
@ApiResponse({
  status: 409,
  description: 'Email already registered',
  schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
})
```

### Error responses use the shared envelope

Error responses must reference the shared `ApiErrorEnvelope` DTO (`nestjs-project/src/common/openapi/api-error-envelope.dto.ts`) via `getSchemaPath(ApiErrorEnvelope)`. Do not invent ad-hoc error shapes and do not inline error schemas — every endpoint in the API returns the same error envelope, and the documentation must reflect that.

`204 No Content` responses carry no body, so they must not declare a `schema`.

### Authenticated endpoints

Protected handlers (those without `@Public()`) must include `@ApiBearerAuth('access-token')` so Swagger UI offers the Authorize button and includes the `Authorization: Bearer …` header in try-it-out calls. Methods marked `@Public()` must **not** carry `@ApiBearerAuth` — that would falsely advertise the endpoint as requiring auth.

```typescript
@Get('me')
@ApiBearerAuth('access-token')
@ApiOperation({ summary: 'Get current user', ... })
me(@CurrentUser() user: JwtPayload): JwtPayload { ... }
```

### Canonical example

`nestjs-project/src/auth/auth.controller.ts` is the reference implementation of the convention above — when in doubt about how to combine these decorators, mirror it.

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
