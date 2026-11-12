# Fase 03 — roteiro de teste manual da API

Valida upload multipart, processamento assíncrono e entrega de mídia, sem passar por autenticação. Use o HTTP Client do IntelliJ/WebStorm com os arquivos de `nestjs-project/http/phase-03-manual/`, escolhendo o ambiente **dev**.

Cada request tem `client.test` que marca ✔/✘ na aba de resultados; o "Esperado" abaixo é o que deve aparecer.

## 1. Preparação (uma vez)

No diretório `nestjs-project/`:

```bash
docker compose up -d
docker compose ps -a
docker compose exec nestjs-api npm run start:dev   # em outro terminal, se a API não responder em :3000
```

Esperado em `ps -a`:

- `db`, `redis`, `minio` e `mailpit` saudáveis;
- `minio-init` e **`dev-seed`** em `Exited (0)`;
- `docker compose logs video-worker` contém `video-worker started`.

O serviço `dev-seed` aplica migrations e a seed a cada `up`. Para repetir manualmente (idempotente):

```bash
docker compose exec nestjs-api npm run seed
```

> Testes e2e limpam o banco de dev. Se rodá-los, execute a seed de novo.

### Massa disponível

| public_id | Status | Dono | Uso |
| --- | --- | --- | --- |
| `ThlVOZkDUF` | READY (arquivos reais no MinIO) | `dev@streamtube.local` | metadados, stream, download, thumbnail |
| `mO46RhTA92` | PROCESSING | `dev@streamtube.local` | visibilidade por status |
| `jgINrSoIxv` | ERROR (`PROBE_FAILED`) | `dev@streamtube.local` | exibição de falha |
| `W8kCDreTVS` | PROCESSING | `other@streamtube.local` | isolamento entre donos |

### Tokens

`ownerToken` (dono) e `otherToken` (outro usuário) já estão em `http-client.env.json`: JWTs com validade de 10 anos, então não há login nem refresh. Se um request devolver `401` inesperado, o `JWT_SECRET` mudou; gere de novo e cole no env:

```bash
docker compose exec nestjs-api node scripts/generate-dev-token.js owner
docker compose exec nestjs-api node scripts/generate-dev-token.js other
```

## 2. Preflight — `00-preflight.http`

| Request | Esperado |
| --- | --- |
| P1 | `200` |
| P2 | `200` (seed e token OK) |
| P3 | `404` (token aceito, vídeo inexistente) |

Se P2 falhar com `404`, falta rodar a seed; com `401`, regenere os tokens.

## 3. Leitura e mídia — `01-leitura-e-midia.http`

### 3.1 Visibilidade dos metadados (`GET /videos/:id`)

| Request | Esperado |
| --- | --- |
| L1 anônimo, READY | `200`, `status: READY`, 6 s, 640×360, `h264`, URLs relativas de stream/download/thumbnail |
| L2 dono, READY | `200` |
| L3 anônimo, PROCESSING | `404 VIDEO_NOT_FOUND` |
| L4 dono, PROCESSING | `200`, `status: PROCESSING` |
| L5 dono, ERROR | `200`, `status: ERROR`, `error_reason: PROBE_FAILED` |
| L6 dono, vídeo PROCESSING de outro | `404` |
| L7 token inválido, READY | `200` (vale como anônimo) |
| L8 id inexistente | `404` |

### 3.2 Entrega de mídia

| Request | Esperado |
| --- | --- |
| M1 stream completo | `200`, `Accept-Ranges: bytes` |
| M2 stream `Range: bytes=0-1023` | `206`, `Content-Range: bytes 0-1023/905702` |
| M3 stream `bytes=900000-` | `206` |
| M4 stream `bytes=999999999-` | `416`, `Content-Range: bytes */905702` |
| M5 download | `200`, `Content-Disposition: attachment` |
| M6 download com Range | `206` |
| M7 download Range inválido | `416` |
| M8 thumbnail | `200`, `image/jpeg` |
| M9 stream de PROCESSING (até com token do dono) | `404` |
| M10 thumbnail de ERROR | `404` |
| M11 stream de id inexistente | `404` |

Opcional: abra `http://localhost:3000/videos/ThlVOZkDUF/stream` no navegador; o vídeo deve tocar e permitir seek.

## 4. Upload e processamento — `02-upload.http`

Execute em ordem; `videoId`, URL da parte e ETag ficam guardados entre os requests.

| Passo | Request | Esperado |
| --- | --- | --- |
| 1 | U1 iniciar | `201`, `status: DRAFT`, uma parte pré-assinada |
| 2 | U1a dono lê o DRAFT | `200`, `DRAFT` |
| 3 | U1b anônimo lê o DRAFT | `404` |
| 4 | U2 enviar parte ao MinIO | `200` e header `ETag` |
| 5 | U3 renovar URL | `200` |
| 6 | U3a parte `99` | `400 INVALID_UPLOAD_PARTS` |
| 7 | U3b lista vazia | `400 VALIDATION_ERROR` |
| 8 | U3c outro usuário | `404` |
| 9 | U4a `parts` vazio | `400 VALIDATION_ERROR` |
| 10 | U4 finalizar | `202`, `status: PROCESSING` |
| 11 | U4b finalizar de novo | `409 VIDEO_NOT_IN_DRAFT` |
| 12 | U4c renovar após finalizar | `409 VIDEO_NOT_IN_DRAFT` |
| 13 | U4d abortar após finalizar | `409 VIDEO_NOT_IN_DRAFT` |
| 14 | U5 (repetir) | `PROCESSING` → `READY` em poucos segundos, com duração 6, 640×360, `h264` |
| 15 | U6a stream com Range | `206` |
| 16 | U6b thumbnail | `200`, `image/jpeg` |
| 17 | U6c metadados anônimo | `200`, `READY` |

Atenção no passo 4: o PUT vai direto ao MinIO (`localhost:9000`); não envie `Authorization` nem mude o `Host`, ou a assinatura falha com `403`.

Se o vídeo ficar em `ERROR`, registre `error_reason` e `docker compose logs video-worker`. Se ficar em `PROCESSING` por mais de 1 min, verifique Redis, MinIO e o worker.

### 4.1 Abortar rascunho

| Request | Esperado |
| --- | --- |
| A1 iniciar | `201` |
| A2 abortar | `204` |
| A3 abortar de novo | `404 VIDEO_NOT_FOUND` |

### 4.2 Validação de entrada e autenticação

| Request | Esperado |
| --- | --- |
| E1 sem token | `401` |
| E2 `application/pdf` | `400 VALIDATION_ERROR` |
| E3 acima de 10 GB | `400 VALIDATION_ERROR` |
| E4 vídeo inexistente | `404` |
| E5 abortar sem token | `401` |

## 5. Upload grande com várias partes (opcional)

O HTTP Client cobre uma parte só. Para multipart real (partes ≥ 5 MiB), use o cliente de CLI com o token do dono:

```bash
docker compose exec nestjs-api npm run upload:video -- \
  --file <caminho-de-um-mp4-grande> \
  --api http://nestjs-api:3000 \
  --storage-connect minio:9000 \
  --token '<ownerToken>'
```

O arquivo precisa existir dentro do container (a pasta do projeto está montada em `/home/node/app`).

## 6. Critério de aceite

A Fase 03 está validada quando, sem nenhum login:

- preflight e todas as tabelas acima têm o resultado esperado;
- um vídeo novo percorre `DRAFT → PROCESSING → READY` e é servido por stream, download e thumbnail.

Registre: `videoId` do upload, códigos HTTP observados, resposta de `GET /videos/:id` em `READY` e logs do worker em caso de falha.
