---
libs:
  "@nestjs/bullmq":
    version: "^11.0.4"
    context7_id: "/nestjs/docs.nestjs.com"
    fetched_at: "2026-06-26T20:05:45-03:00"
  bullmq:
    version: "^5.79.1"
    context7_id: "/websites/bullmq_io"
    fetched_at: "2026-06-26T20:05:45-03:00"
  "@aws-sdk/client-s3":
    version: "^3.x"
    context7_id: "/aws/aws-sdk-js-v3"
    fetched_at: "2026-06-26T20:05:45-03:00"
  "@aws-sdk/s3-request-presigner":
    version: "^3.x"
    context7_id: "/aws/aws-sdk-js-v3"
    fetched_at: "2026-06-26T20:05:45-03:00"
  nanoid:
    version: "^3.3.15"
    context7_id: "/ai/nanoid"
    fetched_at: "2026-06-26T20:05:45-03:00"
sources_mtime:
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-06-26T19:55:55-03:00"
---

# phase-03-videos — Library References

Docs destiladas das bibliotecas decididas na Fase 03, confirmadas via Context7 + `npm view` (2026-06-26). Re-fetch quando a TD de origem mudar. Mantenha `@aws-sdk/client-s3` e `@aws-sdk/s3-request-presigner` na mesma minor.

| package | version | context7_id | TD |
|---|---|---|---|
| `@nestjs/bullmq` | `^11.0.4` | `/nestjs/docs.nestjs.com` | TD-01, TD-05 |
| `bullmq` | `^5.79.1` | `/websites/bullmq_io` | TD-01, TD-05, TD-10 |
| `@aws-sdk/client-s3` | `^3.x` | `/aws/aws-sdk-js-v3` | TD-02, TD-03, TD-08 |
| `@aws-sdk/s3-request-presigner` | `^3.x` | `/aws/aws-sdk-js-v3` | TD-02, TD-03, TD-09 |
| `nanoid` | `^3.3.15` (linha CommonJS) | `/ai/nanoid` | TD-07 |

Compatibilidade verificada:
- `@nestjs/bullmq@11.0.4` peerDeps `@nestjs/common|core ^10||^11`, `bullmq ^3||^4||^5` → ok com NestJS 11 + Node 22 + CommonJS.
- `bullmq` puro Node/Redis, roda em CommonJS.
- `@aws-sdk/*` v3 com builds duais CJS+ESM.
- `nanoid` v5+ é ESM-only (`ERR_REQUIRE_ESM` em CJS); a linha v3 (`legacy` dist-tag → `3.3.15`) é CommonJS. **Usar `^3.3.15`.**

## @nestjs/bullmq + bullmq

> Atenção: a página do Context7 mistura a sintaxe legada do `@nestjs/bull` (chave `redis`) com `@nestjs/bullmq`. Em `@nestjs/bullmq` a chave de conexão é **`connection`**, não `redis`.

### Root config (async, Redis via ConfigService)
```typescript
import { BullModule } from '@nestjs/bullmq';

BullModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    connection: {
      host: config.getOrThrow<string>('REDIS_HOST'), // nome do serviço Docker, ex.: "redis"
      port: config.getOrThrow<number>('REDIS_PORT'),
    },
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 }, // 1s, 2s, 4s
      removeOnComplete: 1000,
      removeOnFail: 5000,
    },
  }),
});
BullModule.registerQueue({ name: 'video-processing' });
```

### Produtor — injetar fila e enfileirar (retry/backoff por job)
```typescript
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

constructor(@InjectQueue('video-processing') private queue: Queue) {}

await this.queue.add('process', { videoId }, {
  attempts: 5,
  backoff: { type: 'exponential', delay: 2000 }, // 2s,4s,8s,16s,32s
});
```

### Consumer — @Processor + WorkerHost (concorrência)
```typescript
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';

@Processor('video-processing', { concurrency: 3 }) // concurrency vai nas WorkerOptions
export class VideoProcessor extends WorkerHost {
  async process(job: Job<{ videoId: string }>): Promise<unknown> {
    // job.name, job.data.videoId; lançar erro dispara retry/backoff
    return { ok: true };
  }
}
// registrar em providers: [VideoProcessor]; o Worker conecta ao instanciar o módulo.
```

### Worker standalone (container separado, só consumer)
```typescript
// main.worker.ts
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  await app.init();
  app.enableShutdownHooks(); // WorkerHost faz worker.close() no destroy
  // sem app.listen(): o Worker do BullMQ mantém o processo vivo pela conexão Redis.
}
bootstrap();
```

## @aws-sdk/client-s3 + @aws-sdk/s3-request-presigner (MinIO)

### Cliente apontando para o MinIO
```typescript
import { S3Client } from '@aws-sdk/client-s3';

new S3Client({
  region: 'us-east-1',            // qualquer valor; MinIO ignora mas o SDK exige
  endpoint: 'http://minio:9000',  // nome do serviço Docker
  forcePathStyle: true,           // OBRIGATÓRIO para MinIO (path-style)
  credentials: {
    accessKeyId: config.getOrThrow('S3_ACCESS_KEY'),
    secretAccessKey: config.getOrThrow('S3_SECRET_KEY'),
  },
});
```

### Bucket idempotente
```typescript
import { HeadBucketCommand, CreateBucketCommand } from '@aws-sdk/client-s3';
try { await s3.send(new HeadBucketCommand({ Bucket })); }
catch (err) {
  const status = err?.$metadata?.httpStatusCode;
  if (status === 404 || err?.name === 'NotFound' || err?.name === 'NoSuchBucket') {
    await s3.send(new CreateBucketCommand({ Bucket }));
  } else throw err;
}
```

### Multipart presigned (cliente sobe as partes direto ao storage)
```typescript
import {
  CreateMultipartUploadCommand, UploadPartCommand,
  CompleteMultipartUploadCommand, AbortMultipartUploadCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// 1) initiate
const { UploadId } = await s3.send(new CreateMultipartUploadCommand({ Bucket, Key, ContentType }));
// 2) uma URL presigned por parte (cliente faz PUT dos bytes; ETag vem no header da resposta)
const url = await getSignedUrl(s3, new UploadPartCommand({ Bucket, Key, UploadId, PartNumber }), { expiresIn: 3600 });
// 3) complete (Parts ordenadas asc por PartNumber)
await s3.send(new CompleteMultipartUploadCommand({
  Bucket, Key, UploadId,
  MultipartUpload: { Parts: [{ PartNumber: 1, ETag: '"..."' }] },
}));
// 3b) abort em falha/cancelamento
await s3.send(new AbortMultipartUploadCommand({ Bucket, Key, UploadId }));
```

### HeadObject (existência/metadados)
```typescript
import { HeadObjectCommand } from '@aws-sdk/client-s3';
const head = await s3.send(new HeadObjectCommand({ Bucket, Key }));
// head.ContentLength, head.ContentType, head.ETag
```

### Download — presigned GET
```typescript
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket, Key }), { expiresIn: 3600 });
```

### Streaming — GetObject com Range (proxy 206)
```typescript
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';

const out = await s3.send(new GetObjectCommand({ Bucket, Key, Range: req.headers['range'] }));
const stream = out.Body as Readable;
res.status(206);
res.setHeader('Content-Range', out.ContentRange!);     // ex.: "bytes 0-1048575/9999999"
res.setHeader('Accept-Ranges', 'bytes');
res.setHeader('Content-Length', out.ContentLength!.toString()); // tamanho DESTE chunk
res.setHeader('Content-Type', out.ContentType ?? 'application/octet-stream');
stream.pipe(res);
```

### PutObject (thumbnail a partir do worker)
```typescript
import { PutObjectCommand } from '@aws-sdk/client-s3';
await s3.send(new PutObjectCommand({ Bucket, Key, Body: buffer, ContentType: 'image/jpeg' }));
```

## nanoid (linha CommonJS `^3.3.15`)

```typescript
import { nanoid, customAlphabet } from 'nanoid'; // ok em CommonJS com v3

nanoid();        // 21 chars URL-safe, ex.: "V1StGXR8_Z5jdHi6B-myT"
nanoid(11);      // tamanho custom
const gen = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 11);
gen();           // ex.: "k3xq9p2m7r1" — usado para public_id do vídeo
```
v5+ é ESM-only e quebra em `require`; a API (`nanoid`, `customAlphabet`, `nanoid/non-secure`) é idêntica entre v3 e v5.
