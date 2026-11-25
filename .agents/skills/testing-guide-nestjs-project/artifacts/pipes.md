> Part of the `testing-guide-nestjs-project` skill (see `../SKILL.md`).

# Pipes (`*.pipe.ts`)

## What to test

Custom pipes transform or validate incoming data. NestJS built-in pipes (`ValidationPipe`, `ParseIntPipe`, `ParseUUIDPipe`) are tested by the framework — only test **custom** pipes you write.

- **Transformation logic** — input is correctly transformed to the expected output
- **Validation logic** — invalid input throws `BadRequestException` or appropriate error
- **Edge cases** — null, undefined, empty strings, boundary values

## Layer assignment

| Scenario | Unit | E2E | Why |
|---|---|---|---|
| Custom pipe with branching/transformation logic | ✅ | — | Pipes are pure transformers; unit test the `transform()` method |
| Built-in pipes (ValidationPipe, ParseUUIDPipe) | ❌ | — | Trust the framework; wiring is tested in E2E |
| Pipe applied globally or per-route | — | ✅ (implicit) | Wiring is tested through controller E2E tests |

## Setup pattern

```typescript
// parse-pagination.pipe.spec.ts
import { BadRequestException } from '@nestjs/common';
import { ParsePaginationPipe } from './parse-pagination.pipe';

describe('ParsePaginationPipe', () => {
  let pipe: ParsePaginationPipe;

  beforeAll(() => {
    pipe = new ParsePaginationPipe();
  });

  it('should parse valid page and limit', () => {
    const result = pipe.transform({ page: '2', limit: '20' });
    expect(result).toEqual({ page: 2, limit: 20 });
  });

  it('should use defaults for missing values', () => {
    const result = pipe.transform({});
    expect(result).toEqual({ page: 1, limit: 10 });
  });

  it('should throw for negative page', () => {
    expect(() => pipe.transform({ page: '-1' })).toThrow(BadRequestException);
  });

  it('should cap limit at maximum', () => {
    const result = pipe.transform({ limit: '1000' });
    expect(result.limit).toBeLessThanOrEqual(100);
  });
});
```

**Key points:**
- Pipes can be tested by directly instantiating and calling `transform()`
- No need for `Test.createTestingModule()` unless the pipe injects dependencies
- If the pipe injects a service (rare), use the testing module to provide mocks
- Test transformation correctness and error cases

## When to skip

- Built-in NestJS pipes — `ValidationPipe`, `ParseIntPipe`, `ParseUUIDPipe`, `ParseBoolPipe`
- `DefaultValuePipe` usage — trust the framework
- Pipes that only pass through to `class-validator` (redundant with DTO E2E tests)

## Examples from project

No custom pipes exist yet. Potential custom pipes:
- **ParsePaginationPipe** — transforms query parameters to pagination object
- **FileValidationPipe** — validates uploaded file type/size for video uploads
