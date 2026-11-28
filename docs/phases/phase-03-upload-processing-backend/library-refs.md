---
libs:
  "@aws-sdk/client-s3":
    version: "^3"
    context7_id: "/aws/aws-sdk-js-v3"
    fetched_at: "2026-11-28T02:11:45-03:00"
  "@aws-sdk/s3-request-presigner":
    version: "^3"
    context7_id: "/aws/aws-sdk-js-v3"
    fetched_at: "2026-11-28T02:11:45-03:00"
  "@nestjs/bullmq":
    version: "^11"
    context7_id: "/nestjs/bull"
    fetched_at: "2026-11-28T02:11:45-03:00"
  "bullmq":
    version: "^5"
    context7_id: "/taskforcesh/bullmq"
    fetched_at: "2026-11-28T02:11:45-03:00"
  "nanoid":
    version: "^6 (ESM-only)"
    context7_id: "/ai/nanoid"
    fetched_at: "2026-11-28T02:11:45-03:00"
  "@nestjs/core":
    version: "^12"
    context7_id: "/nestjs/docs.nestjs.com"
    fetched_at: "2026-11-28T02:11:45-03:00"
  "@nestjs/common":
    version: "^12"
    context7_id: "/nestjs/docs.nestjs.com"
    fetched_at: "2026-11-28T02:11:45-03:00"
  "@nestjs/platform-express":
    version: "^12"
    context7_id: "/nestjs/docs.nestjs.com"
    fetched_at: "2026-11-28T02:11:45-03:00"
  "@nestjs/testing":
    version: "^12"
    context7_id: "/nestjs/docs.nestjs.com"
    fetched_at: "2026-11-28T02:11:45-03:00"
  "@nestjs/cli":
    version: "^12"
    context7_id: "/nestjs/docs.nestjs.com"
    fetched_at: "2026-11-28T02:11:45-03:00"
  "@nestjs-modules/mailer":
    version: "^4"
    context7_id: "/nest-modules/mailer"
    fetched_at: "2026-11-28T02:11:45-03:00"
  "typescript":
    version: "^6"
    context7_id: "/microsoft/typescript"
    fetched_at: "2026-11-28T02:11:45-03:00"
  "jest":
    version: "^30"
    context7_id: "/jestjs/jest"
    fetched_at: "2026-11-28T02:35:58-03:00"
  "ts-jest":
    version: "^29.4"
    context7_id: "/kulshekhar/ts-jest"
    fetched_at: "2026-11-28T02:35:58-03:00"
  "@types/jest":
    version: "^30"
    context7_id: "/jestjs/jest"
    fetched_at: "2026-11-28T02:35:58-03:00"
  "@types/node":
    version: "^24"
    context7_id: "n/a (sem entrada no Context7)"
    fetched_at: "2026-11-28T02:35:58-03:00"
sources_mtime:
  docs/decisions/technical-decisions-phase-03-upload-processing-backend.md: "2026-11-28T02:32:09-03:00"
  docs/decisions/technical-decisions-backend-nest12-runtime-test-runner.md: "2026-11-28T02:27:13-03:00"
---

# Library refs — phase-03-upload-processing-backend

Cache de documentação (Context7) das libs decididas nesta fase. Versões indicam o range alvo, a confirmar na instalação.

### @aws-sdk/client-s3

- Cliente para MinIO: `new S3Client({ endpoint, forcePathStyle: true, region, credentials })` (TD-01). O `endpoint` do cliente de servidor usa o nome do serviço Docker, mas URLs presigned devem ser assinadas com o host público do storage.
- Multipart (TD-02/TD-09/TD-10): `CreateMultipartUploadCommand`, `UploadPartCommand` (presigned por parte), `CompleteMultipartUploadCommand`, `AbortMultipartUploadCommand`, `ListMultipartUploadsCommand` (job de limpeza). `HeadObjectCommand` para verificar `ContentLength` no `complete`.

### @aws-sdk/s3-request-presigner

- `getSignedUrl(client, command, { expiresIn })`; `expiresIn` padrão 900s. Aceita `UploadPartCommand` (upload por parte) e `GetObjectCommand` (streaming/download, com `ResponseContentDisposition` para forçar download).
- Headers `x-amz-*` que devem ser assinados precisam estar em `unhoistableHeaders`.

### @nestjs/bullmq

- `BullModule.forRootAsync({ inject: [ConfigService], useFactory: (config) => ({ connection: ... }) })` e `BullModule.registerQueueAsync({ name, useFactory, inject })` com `defaultJobOptions: { attempts, backoff }`.
- Consumer: `@Processor('fila') class X extends WorkerHost { async process(job) {} }`, com `@OnWorkerEvent('failed' | 'completed')`. Produtor: `@InjectQueue('fila')`.
- Worker standalone (TD-04): `NestFactory.createApplicationContext(AppModule)` sem HTTP; `app.close()` no shutdown.

### bullmq

- Retries: `queue.add(name, data, { attempts: 3, backoff: { type: 'exponential', delay: 1000 } })`; sem `attempts` o job que falha não é repetido.
- Jobs longos (ffmpeg): `lockDuration` padrão 30000ms, com renovação automática a cada metade; job que perde o lock vira stalled e volta para `wait` até `maxStalledCount` (padrão 1), depois vai para `failed`. Ajustar `lockDuration` e `stalledInterval` no worker.

### nanoid

- `customAlphabet(alphabet, size)` gera o `publicId` curto (TD-08), com alfabeto de 1 a 256 símbolos; tamanho padrão 21.
- **Atenção:** a partir da v4 é ESM-only (a v6 exige Node ^22 || ^24 || >=26). Com o backend em Nest 11/CommonJS, `require('nanoid')` falha; a 3.x mantém CommonJS. Com a migração para Nest 12 (TD-12 B, ESM) a v6 é utilizável. Relevante para a ordem de execução TD-12 antes de TD-08.

### @nestjs/core

- `nest upgrade` (a partir da raiz) move todos os `@nestjs/*` reconhecidos para a major 12, sobe o TypeScript para 6, ajusta `engines.node` para >=20.19.0, move opções do `@nestjs/config` para `validationOptions.libraryOptions`, sobe Joi para 18 e Jest para 30, e avisa que o Jest só faz `require()` dos pacotes ESM-only do Nest 12 no Node 24.9+. `--dry-run` mostra o relatório sem alterar arquivos.
- Node: rodar a aplicação exige v20.19+ (ou v22.12+ na linha 22). `nest new/generate/upgrade` exige v22.22.3+, v24.15+ ou v26+.
- Os pacotes v12 são ESM-only (consumo via `require(esm)` a partir de 20.19/22.12). Checar `tsconfig` (moduleResolution legado, `rootDir`).

### @nestjs/common

- Mesmo conjunto de pacotes do `@nestjs/core` (Nest 12, TD-12): ver a seção `@nestjs/core`. Todos os `@nestjs/*` sobem juntos para a mesma major.

### @nestjs/platform-express

- Mesmo conjunto de pacotes do `@nestjs/core` (Nest 12, TD-12): ver a seção `@nestjs/core`.

### @nestjs/testing

- Mesmo conjunto de pacotes do `@nestjs/core` (Nest 12, TD-12): ver a seção `@nestjs/core`. Os testes seguem com Jest (`backend-nest12-runtime-test-runner/TD-02`).

### @nestjs/cli

- Mesmo conjunto de pacotes do `@nestjs/core` (Nest 12, TD-12): ver a seção `@nestjs/core`. O CLI 12 exige TypeScript 6 e roda `nest upgrade` e `nest generate` apenas em Node 22.22.3+, 24.15+ ou 26+.

### @nestjs-modules/mailer

- v4 (breaking): retry padrão de 3 tentativas com backoff (`retry: false` restaura o v3); erros tipados (`MailerError`, `wrapErrors: false` restaura); texto derivado do HTML e validação antes do envio (opt-out); `MailerTestModule`/`TestMailbox`; `MailerPreviewModule` só ligado em `development`/`test`; payload de eventos e `MailableContext.to` mudaram.
- Config assíncrona: `MailerModule.forRootAsync({ imports: [ConfigModule], inject: [ConfigService], useFactory })` com `HandlebarsAdapter`. Peers: handlebars >=4.7.10 e nodemailer >=8.0.5.

### typescript

- TS 6.0: opções como `module=AMD` e `moduleResolution=classic/node10` estão deprecadas (erro TS5107), e deixam de funcionar no 7.0. Silenciar com `"ignoreDeprecations": "6.0"` só como paliativo. Migração: https://aka.ms/ts6.

### jest

- Jest 30 no projeto CommonJS (`backend-nest12-runtime-test-runner/TD-02`): carrega os pacotes ESM-only do Nest 12 (e o `nanoid` 6) via `require(esm)`, o que exige Node 24.9 ou superior. Falha com `ERR_REQUIRE_ASYNC_MODULE` quando o grafo ESM usa top-level await. É esse o gatilho de reversão para o Vitest.
- `jest.mock` não se aplica quando o arquivo resolvido é ESM. Nesse caso use `jest.unstable_mockModule`. No Node 24.9+ o automock e os `__mocks__` também valem para ESM, mas só para grafos síncronos. O projeto hoje só usa `jest.fn`, `jest.Mock` e `jest.Mocked`, sem `jest.mock`.
- `--runInBand` roda os testes na mesma thread. O `test:integration` já usa isso por causa do banco compartilhado.

### ts-jest

- Versão 29.4.x suporta `jest ^29 || ^30` e `typescript >=4.3 <7`, então o TypeScript 6 do TD-12 é compatível (o 7 não seria). Engines: Node ^14.15 || ^16.10 || ^18 || >=20.
- Opções úteis: `tsconfig` (arquivo ou objeto inline), `diagnostics` (type-check, ligado por padrão), `isolatedModules` (agora via `tsconfig.isolatedModules`) e `useESM` (padrão `false`, mantém a saída CommonJS).

### @types/jest

- Versão alinhada ao Jest 30. O `tsconfig.json` atual lista `"types": ["jest", "node"]`.

### @types/node

- A major deve acompanhar o Node da imagem (`backend-nest12-runtime-test-runner/TD-01`: Node 24, então `@types/node@^24`). Hoje o `package.json` tem `^22.10.7`. Não há entrada no Context7 para este pacote.
