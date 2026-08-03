# Fase 03 — Upload e Processamento de Vídeos — Library References

> **Gerado em:** 2026-08-03, a partir de `nestjs-project/package.json` (versões declaradas) e verificação direta em `node_modules` dentro do container `nestjs-api` (versões efetivamente instaladas — idênticas às declaradas, sem drift).
> **Nota sobre consulta oficial:** o Context7 MCP estava indisponível no ambiente durante a pesquisa da Fase 03 (2026-08-01) — documentado em `docs/phases/phase-03-videos/context.md` §Restrições. A pesquisa usou WebSearch como fallback, sobre tópicos gerais (não uma consulta a uma página de documentação oficial específica e citável por library). Por isso, a coluna "Referência oficial consultada" está marcada **"referência a confirmar"** onde não há evidência de uma consulta pontual e verificável — nenhuma URL foi inventada.

| Biblioteca | Versão instalada | Finalidade no projeto | Referência oficial consultada |
|---|---|---|---|
| `@aws-sdk/client-s3` | 3.1101.0 | Cliente S3 usado como wrapper de acesso ao MinIO (`StorageService`): `CreateMultipartUploadCommand`, `UploadPartCommand`, `CompleteMultipartUploadCommand`, `AbortMultipartUploadCommand`, `GetObjectCommand`, `PutObjectCommand` | referência a confirmar |
| `@aws-sdk/s3-request-presigner` | 3.1101.0 | Geração de URLs pré-assinadas (`getSignedUrl`) para upload direto de partes multipart e para leitura (streaming/download/thumbnail) | referência a confirmar |
| `@nestjs/bullmq` | 11.0.4 | Integração NestJS↔BullMQ: `BullModule`, `@InjectQueue`, `@Processor`, `WorkerHost`, compartilhado entre `nestjs-api` (produtor) e `video-worker` (consumidor) | referência a confirmar |
| `bullmq` | 5.81.3 | Motor de fila (job `video-processing`), backing store Redis | referência a confirmar |
| `fluent-ffmpeg` | 2.1.3 | Wrapper de alto nível sobre o binário `ffmpeg`/`ffprobe` — extração de duração/metadados e geração de thumbnail (`screenshots`) no `VideoProcessorService` | referência a confirmar |
| `ffmpeg-static` | 5.3.0 | Binário `ffmpeg` estático, sem dependência de instalação no SO da imagem Docker do worker | referência a confirmar |
| `ffprobe-static` | 3.1.0 | Binário `ffprobe` estático, usado para extração de metadados/duração real | referência a confirmar |

## Observações

- `ffmpeg-static`/`ffprobe-static` não têm `@types` — o projeto usa cast explícito na fronteira (`as unknown as string` / `{path:string}`), registrado em `progress.md` (INC-03.10), seguindo a convenção já usada no restante do código para bibliotecas sem tipos.
- A API do `@nestjs/bullmq@11.0.4` (`BullModule`, `InjectQueue`, `Processor`, `WorkerHost`) foi confirmada diretamente lendo o pacote instalado antes de escrever o código (registrado em `progress.md`, INC-03.5), não via consulta a uma doc externa citável.
- Nenhuma dessas 7 bibliotecas era usada no projeto antes da Fase 03 (confirmado em `context.md` §Estado herdado das Fases 01 e 02 — nenhum hit para `bullmq`/`ffmpeg`/`S3Client`/`minio` em `src/` ou `package.json`).
