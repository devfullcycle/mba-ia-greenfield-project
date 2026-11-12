# Coleção manual — Fase 03

Requests do HTTP Client (IntelliJ/WebStorm) com valores fixos para validar só a Fase 03.
Roteiro passo a passo: `docs/phases/phase-03-videos/manual-api-test.md`.

| Arquivo | Conteúdo |
| --- | --- |
| `00-preflight.http` | API no ar, seed e token válidos |
| `01-leitura-e-midia.http` | Metadados, visibilidade por status/dono, stream, download, thumbnail, Range (vídeos da seed) |
| `02-upload.http` | Upload multipart completo, renovação de URLs, abort, erros de validação |
| `http-client.env.json` | Ambiente `dev`: `baseUrl`, `ownerToken`, `otherToken` |

Não há login: `ownerToken` e `otherToken` são JWTs de 10 anos assinados com o `JWT_SECRET` de dev
(`change-me-in-production`), dos usuários criados pela seed. Se o segredo mudar, gere de novo:

```bash
docker compose exec nestjs-api node scripts/generate-dev-token.js owner   # ou: other
```

Massa da seed (`docker compose exec nestjs-api npm run seed`, idempotente):

| public_id | Status | Dono |
| --- | --- | --- |
| `ThlVOZkDUF` | READY (arquivos reais no MinIO) | dev@streamtube.local |
| `mO46RhTA92` | PROCESSING | dev@streamtube.local |
| `jgINrSoIxv` | ERROR (`PROBE_FAILED`) | dev@streamtube.local |
| `W8kCDreTVS` | PROCESSING | other@streamtube.local |

Os testes e2e limpam o banco de dev: rode a seed de novo depois deles.
