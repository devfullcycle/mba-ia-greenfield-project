---
paths:
  - 'nestjs-project/**/*.dto.ts'
description: 'DTO conventions for input validation and data transfer'
---

# DTO Rules

## Validation

- Always use `class-validator` decorators on every field (`@IsString()`, `@IsEmail()`, `@IsNotEmpty()`, etc.)
- Apply `class-transformer` decorators when type coercion is needed (e.g., `@Type(() => Number)`)

## OpenAPI Documentation

DTOs are the source of request/response schemas in the exported `openapi.json`. Field-level documentation is the DTO's responsibility — controllers document operations (status codes, summaries), not schemas.

### Default: rely on the Swagger CLI plugin (request DTOs)

The project runs the `@nestjs/swagger` CLI plugin, configured in `nestjs-project/nest-cli.json` with `classValidatorShim: true` and `introspectComments: true`. For a request DTO that already carries `class-validator` decorators (`@IsEmail`, `@IsString`, `@MinLength`, `@MaxLength`, `@IsOptional`, `@Type`, …), the plugin auto-generates `@ApiProperty` from those decorators and from the TypeScript type of the field. Do **not** add `@ApiProperty` manually in this case:

- It is redundant — the plugin already emits the same metadata.
- It drifts from the validation rule. `@ApiProperty({ minLength: 8 })` on a field with `@MinLength(8)` becomes a lie the day someone changes the validator to `@MinLength(12)` and forgets the swagger annotation.

For `description` and `example`, write a JSDoc comment above the field — `introspectComments: true` picks it up:

```typescript
export class LoginDto {
  /** User's registered email. */
  @IsEmail()
  email: string;
}
```

Canonical request DTO: `nestjs-project/src/auth/dto/register.dto.ts` (purely `class-validator`, zero `@ApiProperty`).

### When `@ApiProperty` is required

Annotate fields explicitly when the plugin cannot infer them:

- **Response DTOs** — shapes that are not validated input have no `class-validator` decorators, so the plugin has nothing to introspect. Every field needs `@ApiProperty`. Canonical example: `nestjs-project/src/common/openapi/api-error-envelope.dto.ts`.
- **Polymorphic / union types** (e.g., `string | string[]`, `oneOf`) — the plugin does not infer unions. Use `@ApiProperty({ oneOf: [...] })`.
- **Optional / nullable fields on a response DTO** — declare `@ApiProperty({ required: false, nullable: true })`.
- **Controlled `example`** that differs from the inferred type (UUID, ISO date, formatted slug, etc.).

### Reuse the shared error envelope

The error envelope is a single DTO across the project (`ApiErrorEnvelope`), referenced from controllers via `getSchemaPath(ApiErrorEnvelope)`. Do not create per-module error DTOs — extend or reuse the envelope instead.

## Separation of Concerns

- Create separate DTOs per operation: `CreateXDto`, `UpdateXDto`, `QueryXDto`
- Never use an entity class as a DTO — entities are database models, DTOs are API contracts
- For update DTOs, use `PartialType(CreateXDto)` from `@nestjs/mapped-types` to avoid duplication

## Naming

- File naming: `create-user.dto.ts`, `update-video.dto.ts`, `query-channel.dto.ts`
- Class naming: `CreateUserDto`, `UpdateVideoDto`, `QueryChannelDto`
