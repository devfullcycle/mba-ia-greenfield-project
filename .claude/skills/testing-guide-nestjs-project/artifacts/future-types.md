> Part of the `testing-guide-nestjs-project` skill (see `../SKILL.md`).

# Future Types

Proactive guidance for NestJS artifact types not yet present in the project but likely to be added based on the project plan (authentication, video processing, email, queues).

---

## Custom Decorators (`*.decorator.ts`)

Custom decorators in NestJS are typically parameter decorators (e.g., `@CurrentUser()`) or composition decorators (combining multiple decorators into one).

**What to test:**
- Parameter decorators that extract data from the request context
- Composition decorators that combine multiple decorators

**Layer assignment:**
- **Parameter decorators** (e.g., `@CurrentUser()`): **E2E only** — test that the extracted value is correctly passed to the handler by testing the endpoint response
- **Composition decorators** (e.g., `@Public()` combining `@SetMetadata()` + others): **Skip** — these are declarative wrappers; test the behavior they enable via E2E

**When to skip:** Most custom decorators are thin wrappers around `createParamDecorator()` or `applyDecorators()` — they have no testable logic.

---

## Event Listeners / Handlers

If the project adopts NestJS's `@nestjs/event-emitter` for internal events (e.g., "user registered" triggers channel creation):

**What to test:**
- Event handler correctly processes the event data
- Side effects (DB writes, emails, queue publishing) occur as expected

**Layer assignment:**
- **Handlers with business logic**: Unit (mock dependencies) + Integration (real DB/external systems)
- **Handlers with only side effects**: Integration (real systems)

**Setup pattern:**
```typescript
// Test the handler directly by calling its method, not by emitting the event
// Event emission is framework behavior; the handler's logic is your code
describe('UserRegisteredHandler', () => {
  it('should create a channel for the new user', async () => {
    await handler.handleUserRegistered({ userId: 'u1', email: 'test@x.com' });
    // Assert channel was created in the database
  });
});
```

---

## Queue Consumers / Processors

When the project adds queue processing (e.g., BullMQ for video transcoding):

**What to test:**
- Processor correctly handles job data
- Error handling — failed jobs are retried or moved to dead letter queue
- Side effects (DB updates, storage writes) occur as expected

**Layer assignment:**
- **Processor with business logic**: Unit (mock deps) + Integration (real DB/storage)
- **Processor with only external system calls**: Integration (real systems)

**Setup pattern:**
```typescript
// Test the process method directly
describe('VideoProcessorConsumer', () => {
  it('should update video status after processing', async () => {
    const job = { data: { videoId: 'v1', filePath: '/tmp/video.mp4' } } as Job;
    await processor.process(job);
    // Assert video status updated in DB
  });
});
```

---

## Scheduled Tasks (Cron)

If the project adds `@nestjs/schedule` for periodic tasks:

**What to test:**
- The scheduled method's logic executes correctly
- Side effects (cleanup, reports, notifications) work as expected

**Layer assignment:**
- Test the method directly as a regular service method (Unit and/or Integration)
- Do NOT test that the cron schedule triggers — trust `@nestjs/schedule`

---

## Health Checks

If the project adds `@nestjs/terminus` for health endpoints:

**What to test:**
- Health endpoint returns 200 when all services are healthy
- Health endpoint returns 503 when a dependency is down

**Layer assignment:** **E2E** — test the `/health` endpoint with supertest

---

## Config Validation

If the project adds `@nestjs/config` with schema validation (e.g., Joi or class-validator):

**What to test:**
- App fails to start with missing required env vars
- App fails to start with invalid env var values

**Layer assignment:** **Unit** (module compilation) — the module should fail to compile with bad config
