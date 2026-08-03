# Fase 03 — Upload e Processamento de Vídeos — Validação Manual

> **Data:** 2026-08-02 (primeira rodada) / 2026-08-03 (rodada de conformidade de entrega final — streaming Range/206 e fluxo de vídeo corrompido via HTTP real)
> **Ambiente:** Docker Compose local (`db` Postgres 17, `mailpit`, `minio`, `redis`, `nestjs-api`, `video-worker`) — todos os 6 serviços `Up`/saudáveis

## 1. Inventário de endpoints reais

Levantado diretamente do código (`videos.controller.ts`); endpoints de `auth.controller.ts` usados apenas como pré-requisitos da cadeia funcional (registro → confirmação → login), fora do escopo da Fase 03 mas necessários para obter um JWT.

| Método | Rota | Auth | Body | Status sucesso | Status erro observados |
|---|---|---|---|---|---|
| POST | `/videos` | JWT obrigatório | `CreateVideoDto` (`originalFilename`, `mimeType`, `sizeBytes`) | 201 | 400 (payload inválido), 401 (sem token) |
| POST | `/videos/:id/complete-upload` | JWT obrigatório | `CompleteUploadDto` (`parts: [{partNumber, eTag}]`) | 200 | 400 (campo errado), 401 (sem/token expirado), 403 (não é o dono), 409 (upload já finalizado) |
| GET | `/videos/:id` | `@Public()` | — | 200 | 404 (vídeo inexistente) |
| POST | `/auth/register` | público | `{email, password}` | 201 | — (pré-requisito, não é foco) |
| GET | `/auth/confirm-email` | público | query `token` | 204 | — |
| POST | `/auth/login` | público | `{email, password}` | 200 | 401 (credenciais inválidas — observado indiretamente) |
| POST | `/auth/forgot-password` | público | `{email}` | 204 | — (verificado apenas para confirmar que o fix do template de e-mail vale para todos os templates, não só confirmação) |

## 2. Resultado por endpoint

### POST /videos
- **Sucesso (201):** `curl -X POST /videos -H "Authorization: Bearer <jwt>" -d '{"originalFilename":"sample.mp4","mimeType":"video/mp4","sizeBytes":3470}'` → `{"id":"...","status":"draft","uploadId":"...","parts":[{"partNumber":1,"url":"http://minio:9000/..."}]}`, header `Location` presente. ✅
- **Erro payload (400):** enviado `{title, description, fileSizeBytes}` (nomes errados) → `400 VALIDATION_ERROR` listando os campos corretos esperados pelo `CreateVideoDto`. ✅
- **Erro auth (401):** sem header `Authorization` → `{"message":"Unauthorized","statusCode":401}`. ✅

### POST /videos/:id/complete-upload
- **Sucesso (200):** após `PUT` real da parte no MinIO (via URL pré-assinada, ETag capturado do header de resposta) → `{"id":"...","status":"processing"}`. ✅
- **Erro conflito (409):** chamado uma segunda vez no mesmo vídeo já completado → `{"statusCode":409,"error":"VIDEO_ALREADY_UPLOADED","message":"Video upload has already been completed"}`. ✅
- **Erro ownership (403):** chamado por um segundo usuário (JWT diferente) sobre o vídeo do primeiro → `{"statusCode":403,"error":"VIDEO_NOT_OWNED","message":"You do not own this video"}`. ✅
- **Erro auth (401):** JWT expirado (TTL 15 min ultrapassado durante a sessão de validação) → `{"message":"Unauthorized","statusCode":401}`, resolvido reautenticando. ✅ (comportamento correto, não é bug)

### GET /videos/:id
- **Sucesso, endpoint público, sem token (200):** vídeo `ready` retorna `originalFilename`, `durationSeconds`, `streamUrl`, `downloadUrl`, `thumbnailUrl` — todas as 3 URLs pré-assinadas confirmadas resolvendo para bytes reais (`curl --resolve minio:9000:127.0.0.1` → 200, tamanhos 3470 bytes original / 1729 bytes thumbnail, batendo exatamente com o arquivo de fixture e o thumbnail real gerado). ✅
- **Erro not-found (404):** UUID aleatório inexistente → `{"statusCode":404,"error":"VIDEO_NOT_FOUND","message":"Video not found"}`. ✅

#### Streaming real via Range requests (206) — rodada 2026-08-03

`streamUrl`/`downloadUrl` são a mesma URL pré-assinada `GetObjectCommand` do MinIO (S3-compatible) — o suporte a `Range` vem nativamente do object storage, não de um endpoint próprio. Comprovado contra o `streamUrl` real de um vídeo `ready` (fixture `sample.mp4`, 3470 bytes), com um script Node executado dentro do container `nestjs-api` (evita qualquer mock — a mesma URL retornada pela API é usada como o navegador/player faria):

- **`Range: bytes=0-99`** → `206 Partial Content`, `Content-Range: bytes 0-99/3470`, `Content-Length: 100`, `Accept-Ranges: bytes` — 100 bytes recebidos, comparados byte a byte com o arquivo original: **idênticos**. ✅
- **`Range: bytes=1000-1199`** (offset no meio do arquivo, para descartar coincidência) → `206 Partial Content`, `Content-Range: bytes 1000-1199/3470`, `Content-Length: 200` — 200 bytes recebidos, **idênticos** ao slice correspondente do original. ✅
- **Sem header `Range` (download completo)** → `200 OK`, `Content-Length: 3470`, corpo completo **idêntico** ao arquivo original. ✅
- **`thumbnailUrl`** → `200 OK`, `Content-Length: 1729`, primeiros 2 bytes `0xFF 0xD8` (assinatura JPEG real). ✅

Isso substitui a limitação registrada no `progress.md` (INC-03.8: "não testei suporte a `Range` via HTTP real") — agora com prova direta de `206` + `Content-Range` + entrega parcial de bytes, não apenas um `GET` 200.

## 3. Fluxo funcional completo

Executado duas vezes de ponta a ponta (uma vez durante a descoberta/correção de bugs, outra vez limpa após os fixes) contra o stack real, sem simulação e sem forçar estado via SQL:

1. `POST /auth/register` → 201, usuário criado.
2. E-mail de confirmação real recuperado via API do Mailpit (`GET /api/v1/messages`, `GET /api/v1/message/<id>`), token extraído do corpo real do e-mail.
3. `GET /auth/confirm-email?token=...` → 204.
4. `POST /auth/login` → 200, JWT real emitido.
5. `POST /videos` → 201, `uploadId` + URL pré-assinada de parte única (arquivo de 3.4KB, uma única parte).
6. `PUT` real da parte no MinIO via URL pré-assinada → 200, ETag capturado do header.
7. `POST /videos/:id/complete-upload` com o ETag real → 200, `status:"processing"`, job real enfileirado no Redis/BullMQ.
8. Polling em `GET /videos/:id` (intervalo 2s) — vídeo marcado `ready` já na primeira iteração (worker processou em ~1-2s), com `durationSeconds:2` (extraído via `ffprobe` real) e `thumbnailUrl` apontando para um JPEG real gerado via `ffmpeg`.

Execução final (segunda rodada, vídeo `5ec63e42-b342-484d-82a6-2252dab736c4`): confirmada em todos os 8 passos, evidências de sistemas externos na Seção 4.

### Rodada 2026-08-03 — conformidade de entrega final (streaming + vídeo corrompido)

Executado novamente de ponta a ponta, sem simulação e sem forçar estado via SQL, desta vez com dois usuários e dois vídeos para cobrir também o caminho de falha real e os 4 códigos de erro (400/401/403/404/409):

1. Usuário A: `POST /auth/register` → 201 (`validate-a-<ts>@example.com`).
2. Token de confirmação real capturado via API do Mailpit → `GET /auth/confirm-email?token=...` → 204.
3. `POST /auth/login` → 200, JWT real.
4. `POST /videos` com `sample.mp4` (3470 bytes) → 201, `uploadId` + URL de parte única.
5. `PUT` real da parte no MinIO → 200, ETag `ea0c8ba42c63e9416834bf1624d08724`.
6. `POST /videos/:id/complete-upload` → 200, `status:"processing"`, job real enfileirado (BullMQ job id 9).
7. Polling `GET /videos/:id` → `ready` após 3026ms, `durationSeconds:2`, `streamUrl`/`downloadUrl`/`thumbnailUrl` reais (vídeo `d0fdf317-f3b1-40a3-9f68-d9f87db85a97`).
8. Validação de streaming Range/206 contra o `streamUrl` real — ver Seção 2. ✅
9. Erros validados sobre o mesmo vídeo/usuário: `POST /videos` payload errado → 400 `VALIDATION_ERROR` (9 mensagens de campo, incluindo os nomes corretos esperados); `POST /videos` sem token → 401; `GET /videos/<uuid-aleatório>` → 404 `VIDEO_NOT_FOUND`; `POST /videos/:id/complete-upload` repetido no mesmo vídeo → 409 `VIDEO_ALREADY_UPLOADED`.
10. Usuário B: registro → confirmação (Mailpit) → login (mesmo padrão dos passos 1-3).
11. Usuário B chama `complete-upload` no vídeo do usuário A → 403 `VIDEO_NOT_OWNED`.
12. Usuário B: `POST /videos` com o fixture `corrupted.mp4` (87 bytes, texto disfarçado de vídeo) → 201; `PUT` real da parte → 200; `complete-upload` → 200, `status:"processing"`, job real enfileirado (BullMQ job id 10).
13. Polling `GET /videos/:id` → **`failed`** após 1006ms (vídeo `64339d4d-327a-43fd-939f-5acb11af2707`), `failureReason` começando com `"ffprobe exited with code 1..."` — o mesmo `ffprobe` real usado em produção rejeitou o arquivo corrompido, sem qualquer mock.

## 4. Efeitos em sistemas externos

- **PostgreSQL:** confirmado via `psql` direto (`select id,status,duration_seconds,storage_key,thumbnail_key,failure_reason,upload_id from videos where id in (...)`):
  - `d0fdf317-...` (sample.mp4): `status='ready'`, `duration_seconds=2`, `thumbnail_key` preenchido, `upload_id` nulo (limpo após conclusão).
  - `64339d4d-...` (corrupted.mp4): `status='failed'`, `duration_seconds` nulo, `thumbnail_key` nulo (thumbnail nunca gerado, como esperado), `failure_reason` com o erro real do `ffprobe`.
- **Mailpit:** confirmado — e-mails reais de confirmação de cadastro (dois usuários nesta rodada) e de reset de senha chegaram e foram recuperados via API HTTP do Mailpit (não via logs da aplicação), provando o caminho de entrega real via SMTP.
- **MinIO:** confirmado via `mc ls -r` (dentro do container `minio`, alias configurado com as credenciais reais do `.env`):
  - `videos/d0fdf317-.../original` (3.4KiB) + `videos/d0fdf317-.../thumbnail.jpg` (1.7KiB) — ambos re-baixados com sucesso (200) via as URLs pré-assinadas retornadas pela API.
  - `videos/64339d4d-.../original` (87B) — **sem** `thumbnail.jpg`, consistente com o processamento ter falhado antes da etapa de geração de thumbnail.
- **Redis/BullMQ:** confirmado via `redis-cli` — job 9 (`data={"videoId":"d0fdf317-..."}`) e job 10 (`data={"videoId":"64339d4d-..."}`) **ambos** aparecem no conjunto `bull:video-processing:completed`, não em `:failed`. Isto é o comportamento correto e esperado (não um bug): por decisão de produto (INC-03.11), o processor captura o erro do `ffprobe` internamente e marca `video.status='failed'` no Postgres **sem relançar** a exceção para o BullMQ — logo o *job* sempre "completa" do ponto de vista da fila, mesmo quando o *vídeo* termina em `failed`. O conjunto `bull:video-processing:failed` representa falhas não tratadas do worker (ex.: exceção não capturada), um cenário diferente.
- **Video Worker:** confirmado via `docker compose logs video-worker` — `Processing videoId=d0fdf317-...` → `Finished processing videoId=d0fdf317-...` (sucesso); `Processing videoId=64339d4d-...` → `ERROR Failed to process videoId=64339d4d-...: Error: ffprobe exited with code 1` seguido de `Invalid data found when processing input` (falha real, tratada, sem crash do processo).

## 5. Divergências encontradas

Dois bugs reais foram descobertos durante esta validação manual — **nenhum dos dois era detectável pela suíte automatizada**, pelos motivos descritos abaixo. Ambos foram corrigidos antes de finalizar esta validação; a suíte completa (unit+integration+e2e, 233 testes) e `tsc --noEmit` foram re-executados após as correções e permanecem 100% verdes.

1. **Container `nestjs-api` nunca reiniciado desde a conversão para monorepo Nest CLI (INC-03.2).** O processo do dev server estava rodando havia mais de 19h, observando um diretório `src/` que já não existia mais (movido para `apps/nestjs-project/src/` no INC-03.2) — servia apenas as rotas da Fase 02, sem nenhuma rota de `/videos`. Corrigido com `docker compose restart nestjs-api`; confirmado via logs que as 3 rotas de vídeo passaram a aparecer no mapeamento do Nest. Isso é uma questão operacional (ambiente ficou desatualizado durante a implementação), não um bug de código — mas só foi descoberto porque a validação manual usa o servidor real rodando, algo que os testes automatizados (que sempre compilam/bootam a aplicação do zero) não exercitam.

2. **Bug real de código: `mail.module.ts` resolvia o diretório de templates Handlebars de forma incompatível com o bundle webpack.** `join(__dirname, 'templates')` funcionava sob `ts-jest`/`ts-node` (onde `__dirname` = `.../src/mail`, um nível acima dos templates) mas quebrava no servidor real rodando via `start:dev`/`start:prod` (bundle webpack do Nest CLI em modo monorepo, onde `__dirname` = raiz do bundle `dist/apps/nestjs-project`, e os templates — copiados pelo Nest CLI preservando o caminho relativo ao `sourceRoot` — ficam um nível mais fundo, em `dist/apps/nestjs-project/mail/templates`). O erro era um `ENOENT` não tratado que **derrubava todo o processo Node** em qualquer chamada a `POST /auth/register` (500, servidor caía e reiniciava). **Este bug era estruturalmente invisível a toda a suíte de testes automatizados**, porque nenhum teste Jest passa pelo build webpack — `ts-jest` sempre resolve `__dirname` por arquivo, nunca pelo bundle. Corrigido com fallback duplo via `existsSync` em `mail.module.ts` (tenta o caminho direto primeiro, cai para o caminho aninhado sob `mail/`). Após o fix, confirmado que **ambos** os templates de e-mail do projeto (`confirm-email` e `reset-password`) funcionam corretamente contra o servidor real.

Nenhuma divergência entre o comportamento real e o plano/critérios de aceite da Fase 03 (`docs/phases/phase-03-videos/phase-03-videos.md`) foi encontrada — todos os contratos de API, status codes e efeitos colaterais bateram exatamente com o especificado.

### Rodada 2026-08-03

Nenhum bug novo encontrado. Um esclarecimento comportamental foi documentado na Seção 4 (job BullMQ sempre "completa" mesmo quando o vídeo termina `failed` — comportamento intencional, não bug). A lacuna registrada em `progress.md` (INC-03.8: streaming Range/206 não testado via HTTP real) foi fechada nesta rodada — ver Seção 2.

## Status final

**clean** — todos os endpoints reais da Fase 03 validados (sucesso + erro), fluxo funcional completo (incluindo o caminho de falha real com vídeo corrompido) confirmado de ponta a ponta contra o stack Docker Compose real, streaming via Range/206 comprovado com bytes idênticos ao original, e efeitos colaterais verificados em PostgreSQL, MinIO, Redis/BullMQ e nos logs do Video Worker. Nenhuma divergência pendente.
