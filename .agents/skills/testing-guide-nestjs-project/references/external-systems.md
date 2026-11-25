> Part of the `testing-guide-nestjs-project` skill (see `../SKILL.md`).

# External System Strategies

How each external system is handled in tests. These strategies were confirmed with the team.

---

## PostgreSQL — Real (Docker)

**Strategy:** Real database via the Docker `db` service (already in `compose.yaml`).

**Connection config for tests:**
```typescript
{
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USERNAME ?? 'streamtube',
  password: process.env.DB_PASSWORD ?? 'streamtube',
  database: process.env.DB_DATABASE ?? 'streamtube',
  synchronize: true, // auto-create tables in test setup
}
```

**Test isolation:**
- Use `dataSource.query('DELETE FROM "table_name"')` to clean tables between tests
- Do NOT use `repository.delete({})` — throws `Empty criteria(s) are not allowed`
- Alternative: `repository.clear()` (truncates the table)
- For complex foreign key chains, delete in reverse dependency order or use `TRUNCATE ... CASCADE`
- Use `beforeEach` for cleanup to ensure each test starts with a clean state

**Entity setup:**
- Use `synchronize: true` in test DataSource to auto-create tables from entities
- For integration tests, import only the entities needed by the test — not all entities
- For E2E tests, import `AppModule` which includes all entities via their domain modules

---

## Object Storage — Local Filesystem

**Strategy:** Local filesystem storage in development and tests. S3 in production.

**Approach:**
- The storage layer should use an abstraction (e.g., `StorageService` interface) that allows switching between local filesystem and S3
- In tests, use the local filesystem adapter — no mocking needed
- Use a temporary directory for test uploads: `os.tmpdir()` or a dedicated `test-uploads/` directory
- Clean up test files in `afterAll`

**Setup pattern:**
```typescript
// In test module setup
{
  provide: 'STORAGE_CONFIG',
  useValue: {
    driver: 'local',
    basePath: path.join(os.tmpdir(), 'streamtube-test-uploads'),
  },
}
```

**Integration test:**
```typescript
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('StorageService (integration)', () => {
  const testDir = path.join(os.tmpdir(), 'streamtube-test-uploads');

  afterAll(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('should upload and retrieve a file', async () => {
    const buffer = Buffer.from('test content');
    const key = await storageService.upload(buffer, 'test.txt');

    const retrieved = await storageService.get(key);
    expect(retrieved.toString()).toBe('test content');
  });
});
```

---

## Message Queue — Real (Docker)

**Strategy:** Real message broker in Docker. The specific technology is TBD per the architecture diagram (likely BullMQ with Redis or RabbitMQ).

**When the queue technology is chosen, configure:**
- A queue broker service in `compose.yaml` (e.g., Redis for BullMQ, RabbitMQ for AMQP)
- Test isolation: use dedicated test queues or clean queues between tests
- For publisher tests: assert the job is enqueued with correct data
- For consumer tests: submit a job and assert the processing outcome

**Setup pattern (BullMQ example):**
```typescript
// In test module
BullModule.forRoot({
  connection: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number(process.env.REDIS_PORT ?? 6379),
  },
}),
BullModule.registerQueue({ name: 'video-processing' }),
```

```typescript
describe('VideoService (integration - queue)', () => {
  it('should enqueue a processing job on upload', async () => {
    await videoService.upload(videoData);

    const queue = module.get<Queue>(getQueueToken('video-processing'));
    const jobs = await queue.getJobs(['waiting']);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].data).toEqual(
      expect.objectContaining({ videoId: expect.any(String) }),
    );
  });
});
```

---

## Email — Mailpit (Real SMTP Capture)

**Strategy:** Mailpit — a local SMTP server that captures all emails for inspection via its API. No emails are actually delivered.

**Setup:**
- Add Mailpit to `compose.yaml`:
```yaml
mailpit:
  image: axllent/mailpit
  ports:
    - "1025:1025"   # SMTP
    - "8025:8025"   # Web UI / API
```

**NestJS configuration:**
```typescript
// In mail module or config
{
  transport: {
    host: process.env.SMTP_HOST ?? 'localhost',
    port: Number(process.env.SMTP_PORT ?? 1025),
  },
}
```

**Integration test:**
```typescript
describe('MailService (integration)', () => {
  beforeEach(async () => {
    // Clear all captured emails via Mailpit API
    await fetch('http://localhost:8025/api/v1/messages', { method: 'DELETE' });
  });

  it('should send confirmation email', async () => {
    await mailService.sendConfirmation('user@test.com', 'token-123');

    // Query Mailpit API for captured emails
    const response = await fetch('http://localhost:8025/api/v1/messages');
    const data = await response.json();

    expect(data.messages).toHaveLength(1);
    expect(data.messages[0].To[0].Address).toBe('user@test.com');
    expect(data.messages[0].Subject).toContain('confirm');
  });
});
```

**Key points:**
- Mailpit captures ALL emails — no mocking, no side effects
- Use Mailpit's REST API (`http://localhost:8025/api/v1/messages`) to inspect sent emails
- Clear captured emails in `beforeEach` to ensure test isolation
- Web UI at `http://localhost:8025` for manual debugging
- Tests the full SMTP transport path — if the SMTP config is wrong, the test fails
