# Fase 03 — Upload e Processamento de Vídeos — Validação Manual

> **Data:** 2026-08-02
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

## 4. Efeitos em sistemas externos

- **PostgreSQL:** confirmado via `psql` direto — linha em `videos` com `status='ready'`, `duration_seconds=2`, `thumbnail_key='videos/<id>/thumbnail.jpg'` preenchidos corretamente após o processamento real.
- **Mailpit:** confirmado — e-mails reais de confirmação de cadastro e de reset de senha chegaram e foram recuperados via API HTTP do Mailpit (não via logs da aplicação), provando o caminho de entrega real via SMTP.
- **MinIO:** confirmado via `mc ls -r` dentro do container `minio` — objetos `original` (3.4KiB) e `thumbnail.jpg` (1.7KiB) presentes na chave esperada (`videos/<id>/...`); ambos re-baixados com sucesso (200) via as URLs pré-assinadas retornadas pela API.
- **Redis/BullMQ:** confirmado via `redis-cli` — job mais recente na lista `bull:video-processing:completed` tem `data = {"videoId":"<id>"}` batendo exatamente com o vídeo testado.
- **Video Worker:** confirmado via `docker compose logs video-worker` — linhas reais `Processing videoId=<id>` seguidas de `Finished processing videoId=<id>`, sem erros, para ambas as execuções do fluxo completo.

## 5. Divergências encontradas

Dois bugs reais foram descobertos durante esta validação manual — **nenhum dos dois era detectável pela suíte automatizada**, pelos motivos descritos abaixo. Ambos foram corrigidos antes de finalizar esta validação; a suíte completa (unit+integration+e2e, 233 testes) e `tsc --noEmit` foram re-executados após as correções e permanecem 100% verdes.

1. **Container `nestjs-api` nunca reiniciado desde a conversão para monorepo Nest CLI (INC-03.2).** O processo do dev server estava rodando havia mais de 19h, observando um diretório `src/` que já não existia mais (movido para `apps/nestjs-project/src/` no INC-03.2) — servia apenas as rotas da Fase 02, sem nenhuma rota de `/videos`. Corrigido com `docker compose restart nestjs-api`; confirmado via logs que as 3 rotas de vídeo passaram a aparecer no mapeamento do Nest. Isso é uma questão operacional (ambiente ficou desatualizado durante a implementação), não um bug de código — mas só foi descoberto porque a validação manual usa o servidor real rodando, algo que os testes automatizados (que sempre compilam/bootam a aplicação do zero) não exercitam.

2. **Bug real de código: `mail.module.ts` resolvia o diretório de templates Handlebars de forma incompatível com o bundle webpack.** `join(__dirname, 'templates')` funcionava sob `ts-jest`/`ts-node` (onde `__dirname` = `.../src/mail`, um nível acima dos templates) mas quebrava no servidor real rodando via `start:dev`/`start:prod` (bundle webpack do Nest CLI em modo monorepo, onde `__dirname` = raiz do bundle `dist/apps/nestjs-project`, e os templates — copiados pelo Nest CLI preservando o caminho relativo ao `sourceRoot` — ficam um nível mais fundo, em `dist/apps/nestjs-project/mail/templates`). O erro era um `ENOENT` não tratado que **derrubava todo o processo Node** em qualquer chamada a `POST /auth/register` (500, servidor caía e reiniciava). **Este bug era estruturalmente invisível a toda a suíte de testes automatizados**, porque nenhum teste Jest passa pelo build webpack — `ts-jest` sempre resolve `__dirname` por arquivo, nunca pelo bundle. Corrigido com fallback duplo via `existsSync` em `mail.module.ts` (tenta o caminho direto primeiro, cai para o caminho aninhado sob `mail/`). Após o fix, confirmado que **ambos** os templates de e-mail do projeto (`confirm-email` e `reset-password`) funcionam corretamente contra o servidor real.

Nenhuma divergência entre o comportamento real e o plano/critérios de aceite da Fase 03 (`docs/phases/phase-03-videos.md`) foi encontrada — todos os contratos de API, status codes e efeitos colaterais bateram exatamente com o especificado.
