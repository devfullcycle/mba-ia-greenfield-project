# StreamTube

Plataforma de compartilhamento de videos desenvolvida no MBA de Engenharia de Software com IA da Full Cycle.

## Arquitetura

Monorepo rodando em containers Docker:

- `nestjs-project/` — Backend em NestJS 11, TypeORM, PostgreSQL 17, Redis 7 (BullMQ), MinIO (S3) e worker dedicado com FFmpeg.
- `next-frontend/` — Frontend em Next.js 16 (App Router + BFF) para as telas de autenticacao.
- `docs/` — Decisoes tecnicas (`docs/decisions/`), diagramas e artefatos de planejamento por fase (`docs/phases/`).

## Como rodar o Backend

```bash
cd nestjs-project

# Sobe os containers (API, worker, Postgres, Redis, MinIO e Mailpit)
docker compose up -d

# Instala as dependencias
docker compose exec nestjs-api npm install

# Executa as migrations no banco
docker compose exec nestjs-api npm run migration:run

# Inicia a API em modo dev
docker compose exec -d nestjs-api npm run start:dev
```

Servicos disponiveis:
- API NestJS: `http://localhost:3000`
- Swagger (com `SWAGGER_ENABLED=true`): `http://localhost:3000/api/docs`
- MinIO Console: `http://localhost:9001` (`minioadmin` / `minioadmin`)
- Mailpit UI: `http://localhost:8025`
- PostgreSQL: `localhost:5432` (`streamtube` / `streamtube`)
- Redis: `localhost:6379`

## Testes e Qualidade

Todos os comandos rodam dentro do container `nestjs-api`:

```bash
cd nestjs-project

# Testes unitarios e de integracao
docker compose exec nestjs-api npm test -- --runInBand

# Testes E2E
docker compose exec nestjs-api npm run test:e2e

# Typecheck e Lint
docker compose exec nestjs-api npx tsc --noEmit
docker compose exec nestjs-api npm run lint
```

## Funcionalidades entregues

### Fase 01 e Fase 02 — Configuracao Base, Autenticacao e Canais
- Cadastro de usuario com criacao automatica de canal (nickname gerado pelo prefixo do e-mail)
- Confirmacao de conta e recuperacao de senha por e-mail (Mailpit + Handlebars)
- Login com JWT e rotacao de refresh token
- Rate limiting e padronizacao de erros de dominio

### Fase 03 — Upload e Processamento de Videos
- Armazenamento de videos e thumbnails no MinIO/S3 (`StorageModule`)
- Upload multipart via URLs pre-assinadas suportando arquivos de ate 10GB sem travar a API
- Pre-cadastro automatico do video como rascunho (`draft`) ao iniciar o upload e geracao de URL unica (`slug`) sem conflito
- Fila de processamento assincrono com BullMQ e Redis (`video-processing`)
- Worker dedicado (`video-worker`) com `ffprobe` e `ffmpeg` para extrair duracao, resolucao, codec e gerar thumbnail JPEG automatica a partir de um frame
- Reproducao via streaming com suporte a HTTP Range (`206 Partial Content`) sem precisar baixar o arquivo inteiro
- Download do video completo (`Content-Disposition: attachment`)

### Endpoints de Videos (`nestjs-project`)

| Metodo & Rota | Descricao |
|---------------|-----------|
| `POST /videos/uploads/init` | Inicia upload multipart (ate 10GB), cria rascunho e retorna URLs pre-assinadas |
| `POST /videos/:id/uploads/parts` | Assina URL para envio de uma parte especifica do upload |
| `POST /videos/:id/uploads/complete` | Finaliza o upload no S3 e enfileira o processamento no BullMQ |
| `DELETE /videos/:id/uploads/abort` | Cancela o upload em rascunho |
| `GET /videos/:slug` | Consulta metadados, status e URLs do video pela URL unica |
| `GET /videos/:slug/stream` | Streaming do video com suporte a `Range` (`206 Partial Content`) |
| `GET /videos/:slug/download` | Download do arquivo de video pelo usuario |
| `GET /videos/:slug/thumbnail` | Retorna a thumbnail JPEG gerada pelo worker |
