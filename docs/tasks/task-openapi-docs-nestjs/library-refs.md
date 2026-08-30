---
libs:
  "@nestjs/swagger":
    version: "^11.0.0"
    context7_id: "/nestjs/swagger"
    fetched_at: "2026-05-12T14:28:49-03:00"
sources_mtime:
  docs/decisions/technical-decisions-openapi-docs-nestjs.md: "2026-05-12T14:27:24-03:00"
---

# Library References — task-openapi-docs-nestjs

Cached Context7 excerpts for libraries decided in this task. Refreshed by `/plan-resolve` when a new library is decided or when the cache is missing for an already-decided TD.

---

## @nestjs/swagger

**Version line:** `^11.0.0` (compatible with `@nestjs/core ^11.0.1` installed in `nestjs-project/`).
**Decided in:** `openapi-docs-nestjs/TD-01` (Option A — `@nestjs/swagger` + CLI plugin).
**Context7 ID:** `/nestjs/swagger`.

### 1. Bootstrap setup (`main.ts`)

```typescript
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const config = new DocumentBuilder()
    .setTitle('StreamTube API')
    .setDescription('API REST do StreamTube')
    .setVersion('1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'access-token')
    .build();

  const document = SwaggerModule.createDocument(app, config);

  // Conditional exposure per TD-03 (Option B — dev/staging only).
  // Concrete condition derives from the SWAGGER_ENABLED env flag added to env.validation.ts (Joi).
  if (process.env.SWAGGER_ENABLED === 'true') {
    SwaggerModule.setup('api/docs', app, document, {
      customSiteTitle: 'StreamTube API Docs',
      swaggerOptions: { persistAuthorization: true },
    });
  }

  await app.listen(3000);
}
bootstrap();
```

**Endpoints exposed (when enabled):**
- `/api/docs` — Swagger UI (HTML).
- `/api/docs-json` — OpenAPI JSON.
- `/api/docs-yaml` — OpenAPI YAML.

### 2. DocumentBuilder reference (most-used methods)

```typescript
new DocumentBuilder()
  .setTitle('...')
  .setDescription('...')
  .setVersion('1.0.0')
  .setContact('Name', 'https://...', 'email@example.com')
  .setLicense('MIT', 'https://opensource.org/licenses/MIT')
  .addServer('https://api.example.com', 'Production server')
  .addServer('https://staging-api.example.com', 'Staging server')
  .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'access-token')
  .addApiKey({ type: 'apiKey', in: 'header', name: 'X-API-KEY' }, 'api-key')
  .addBasicAuth({ type: 'http', scheme: 'basic' }, 'basic')
  .addOAuth2({ /* ... */ })
  .addCookieAuth('session-id')
  .addSecurityRequirements('access-token')
  .addGlobalParameters({ name: 'X-Request-Id', in: 'header', required: false, schema: { type: 'string' } })
  .build();
```

### 3. CLI plugin (`nest-cli.json`)

Enables automatic schema inference from `class-validator` decorators — no need for `@ApiProperty` on every DTO field.

```json
{
  "compilerOptions": {
    "plugins": [
      {
        "name": "@nestjs/swagger",
        "options": {
          "classValidatorShim": true,
          "introspectComments": true,
          "dtoFileNameSuffix": [".dto.ts", ".entity.ts"]
        }
      }
    ]
  }
}
```

**Options reference:**
- `classValidatorShim: true` — extracts schema from `class-validator` decorators (`@IsEmail`, `@IsString`, `@MinLength`, etc.). Load-bearing for this project (TD-06 phase-02-auth fixed `class-validator` as the validation lib).
- `introspectComments: true` — converts JSDoc comments on DTO fields into OpenAPI `description` fields.
- `dtoFileNameSuffix` — file patterns whose classes the plugin analyzes. Defaults are `.dto.ts` and `.entity.ts`; extend if needed.

The plugin emits a `metadata.ts` file alongside the build (filename configurable). Load it before `createDocument`:

```typescript
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await SwaggerModule.loadPluginMetadata((await import('./metadata')).default);
  // ... DocumentBuilder + setup ...
}
```

### 4. Response documentation decorators

```typescript
import {
  ApiResponse, ApiOkResponse, ApiCreatedResponse,
  ApiBadRequestResponse, ApiNotFoundResponse, ApiUnauthorizedResponse,
  ApiExtraModels, getSchemaPath,
} from '@nestjs/swagger';

@Controller('users')
@ApiTags('users')
export class UsersController {
  @Post()
  @ApiCreatedResponse({ description: 'User created', type: UserDto })
  @ApiBadRequestResponse({ description: 'Validation failed', type: ErrorResponseDto })
  create(@Body() dto: CreateUserDto) { /* ... */ }

  @Get(':id')
  @ApiOkResponse({ type: UserDto })
  @ApiNotFoundResponse({ description: 'User not found', type: ErrorResponseDto })
  findOne(@Param('id') id: string) { /* ... */ }
}
```

The error envelope DTO (`ErrorResponseDto`) must mirror the shape decided in `phase-02-auth/TD-07` (`{ statusCode, error, message }` with domain codes).

### 5. Security scheme decorators (per-endpoint)

```typescript
import { ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';

@ApiTags('protected')
@ApiBearerAuth('access-token')   // matches DocumentBuilder's .addBearerAuth(..., 'access-token')
@Controller('me')
export class MeController {
  @Get()
  getProfile() { /* ... */ }
}
```

### 6. Static spec export (per TD-02)

For the `openapi.json` export script (TD-02 Option C — Both), the canonical pattern is a standalone Nest script:

```typescript
// nestjs-project/src/openapi-export.ts (executed via ts-node, not bundled)
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { writeFileSync } from 'node:fs';
import { AppModule } from './app.module';

async function exportSpec() {
  const app = await NestFactory.create(AppModule, { logger: false });
  const config = new DocumentBuilder()
    .setTitle('StreamTube API')
    .setVersion('1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'access-token')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  writeFileSync('openapi.json', JSON.stringify(document, null, 2));
  await app.close();
}
exportSpec();
```

Wire as an npm script in `package.json`:

```json
{
  "scripts": {
    "openapi:export": "ts-node -r tsconfig-paths/register src/openapi-export.ts"
  }
}
```

The script must instantiate `AppModule` end-to-end (so the same metadata used at runtime is the source of the file) but call `app.close()` instead of `app.listen()` — no HTTP server is started.

### 7. Type helpers for derived DTOs

Use `PartialType`, `PickType`, `OmitType` from `@nestjs/swagger` (NOT `@nestjs/mapped-types`) when you want the derived DTO to inherit Swagger metadata in addition to `class-validator` decorators:

```typescript
import { PartialType, PickType, OmitType } from '@nestjs/swagger';

export class UpdateUserDto extends PartialType(CreateUserDto) {}
export class PublicUserDto extends PickType(UserDto, ['id', 'nickname'] as const) {}
export class CreateUserBodyDto extends OmitType(UserDto, ['id', 'createdAt'] as const) {}
```
