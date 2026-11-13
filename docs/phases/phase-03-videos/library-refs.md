# Phase 03 — Referências de Bibliotecas

> **Status:** referências iniciais para fixação no plano; versões finais devem ser confirmadas no `package.json` e na documentação oficial antes da instalação.

| Biblioteca/serviço | Uso na fase | Referência oficial |
|---|---|---|
| BullMQ | Filas, jobs, retries e worker | https://docs.bullmq.io/ |
| `@nestjs/bullmq` | Integração BullMQ com NestJS | https://docs.nestjs.com/techniques/queues |
| Redis | Backend persistente da fila | https://redis.io/docs/latest/ |
| `minio` | Cliente S3-compatible para MinIO | https://docs.min.io/aistor/developers/sdk/javascript/ |
| AWS S3 API | Semântica de multipart e URLs pré-assinadas | https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html |
| FFmpeg | Geração de thumbnail e processamento | https://ffmpeg.org/ffmpeg.html |
| ffprobe | Duração e metadados | https://ffmpeg.org/ffprobe.html |
| HTTP Range | Streaming parcial | https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Range_requests |

## Pontos a confirmar no plan-resolve

- Compatibilidade das versões de BullMQ e `@nestjs/bullmq` com NestJS 11.
- Cliente Redis escolhido e configuração de conexão dentro do Compose.
- APIs de multipart e presigned URLs disponíveis na versão do cliente MinIO fixada.
- Estratégia de streaming por intervalo suportada pelo cliente MinIO sem carregar o objeto inteiro.
- Imagem/base do worker com versões disponíveis de FFmpeg e ffprobe.
