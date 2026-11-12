# Fase 03 — Upload e Processamento de Vídeos: relatório de implementação

Data: 2026-11-10. Fonte: `progress.md`, `phase-03-videos.md` e o histórico git (`260d0c2..4019624`).

## 1. Resumo

A fase entregou, no `nestjs-project/`, o upload de vídeos de até 10GB com pré-cadastro em rascunho, o processamento em background (metadados e thumbnail via FFmpeg, fila BullMQ/Redis), `public_id` único por vídeo (Sqids), e a entrega por streaming (com `Range`) e download via proxy da API sobre MinIO/S3. Também foi criado o cliente de upload `scripts/upload-video.ts`.

Resultado: 13/13 SIs concluídas. A validação final teve dois ciclos independentes, sem bloqueantes no ciclo 2. A branch `feature/phase-03-videos` foi mergeada na `dev` no commit `4019624`, localmente e sem push.

Suíte final: 317 testes unit+integration, 83 e2e e 5 e2e de vídeo. `tsc --noEmit` (exit 0), lint, `openapi:export` (sem diff) e build passaram.

## 2. O que foi entregue

| SI | Entrega | Commit | Testes |
|---|---|---|---|
| 03.1 | Redis e MinIO no Compose, validação de config de storage/fila/vídeo | `4185106` | 13 |
| 03.2 | `StorageModule` com clientes S3 interno e público | `55b36fb` | 11 |
| 03.3 | Entidade `Video`, migration `CreateVideos`, `public_id` bijetivo via Sqids | `eb645e4` | 181 (suíte completa na época) |
| 03.4 | Fila `video-processing` no Redis e processo `video-worker` | `85446d8` | 10 |
| 03.5 | `POST /videos/uploads` com pré-cadastro em DRAFT | `1fe204e` | 17 |
| 03.6 | `POST /videos/:id/uploads/parts` e `DELETE /videos/:id/uploads` | `ec0bc98` | 17 |
| 03.7 | `POST /videos/:id/uploads/complete` e enfileiramento | `a398445` | 22 |
| 03.8 | Processamento no worker: metadados, thumbnail, política de falha | `5241c5c` | 33 |
| 03.9 | Reconciler de vídeos presos em PROCESSING | `c33430a` | 10 |
| 03.10 | `GET /videos/:id` com autenticação opcional | `8545b7b` | 29 |
| 03.11 | `stream`, `download` e `thumbnail` via proxy com `Range` | `59488e7` | 18 |
| 03.12 | Cliente de upload multipart com memória constante | `7e41d15`, ajuste em `8c5c6b7` | 7 (+ re-prova de RSS) |
| 03.13 | Prova de entrega ponta a ponta e documentação dos serviços | `c8cf0e3` | 2 (e2e no `video-worker`) |

Os commits seguem a regra de um commit por SI. As correções posteriores estão na seção 5.

## 3. Prova de entrega

### 3.1 Upload de 10GB

Arquivo de 10.489.279.614 bytes (MPEG-4 1920x1080, 3000s), enviado com `npm run upload:video` dentro do container `nestjs-api`.

| Item | Resultado |
|---|---|
| Upload | exit 0, 40s |
| Processamento | vídeo `aCWjUcTEYt` em `READY`, duração 3000s e dimensões extraídas pelo worker |
| Streaming | `GET /videos/aCWjUcTEYt/stream` com `Range: bytes=10000000000-10000001023`: `206`, 1024 bytes, 27ms |
| Latência da API durante o upload | `GET /videos/:id` de outro vídeo: 20/20 respostas `200`, mediana 12,1ms, máx. 20,7ms (repouso: mediana 3,4ms) |
| Memória da API | RSS 161MB em repouso, um degrau para 344MB no `initiate`, plano em 344MB durante a transferência |

Os bytes vão direto do cliente ao MinIO por URLs pré-assinadas, então a API não os toca. O degrau no `initiate` vem em parte da pré-assinatura das ~2.000 URLs de parte. Esse número cresce com o tamanho do arquivo até o teto de 10.000, então o degrau é limitado, mas não estritamente independente do tamanho. Um segundo upload terminou em 352MB, ou seja, a memória não cresce com o volume transferido.

Ressalva registrada: nas rodadas seguintes o RSS ficou em ~340 MiB após 30s ocioso (heap retido ainda não coletado). Está nos follow-ups.

Uma segunda rodada de 10GB falhou com `507` do MinIO na parte 1392 porque o disco da VM do Docker encheu (55GB). O rascunho foi abortado via `DELETE` (204) e liberou 7GB.

### 3.2 Memória do cliente de upload (RSS)

- **Afirmação inicial errada.** O AC "RSS do cliente abaixo de part_size × concurrency + 100MB" foi dado como coberto. Para o arquivo de 10GB o limite é 5 MiB × 4 + 100 MiB = 120 MiB. O cliente via `ts-node` mediu 162–226MB, e como JS compilado ainda ficou em ~157 MiB.
- **Causa.** Não era vazamento, o backpressure funcionava. Cada parte de 5 MiB é lida como ~80 Buffers de 64 KiB (`highWaterMark` padrão do `createReadStream`). Esses buffers externos só são liberados quando os wrappers JS (pequenos) são coletados pelo scavenge. Até ~65 MiB de buffers mortos se acumulam entre GCs da young generation, e a glibc mantém o pico no RSS.
- **Tentativas que não resolveram.** Mudar o `highWaterMark`: com 1 MiB os buffers vão para `mmap` e o RSS oscila; com 16 KiB o heap cresce.
- **Correção.** `upload:video` passou a rodar `tsc -p tsconfig.scripts.json && node --max-semi-space-size=1 dist-scripts/scripts/upload-video.js`. Scavenges mais frequentes liberam os buffers mais cedo.
- **Re-prova com o npm script real.** 2001 partes de 5 MiB, concorrência 4, upload em 35,2s, vídeo `9qFQxEJqyc` em `READY` ~8s depois. RSS em 30 amostras: mín. 88,8 / mediana 106,6 / máx. **108,9 MiB**, contra o limite de 120 MiB.
- **Nota sobre a margem.** Se "100MB" for decimal, o limite cai para ~115,4 MiB e a margem é de ~6,5 MiB, não ~11 MiB (Follow-up 15). A medição a ~1 Hz pode perder picos.
- Latência da API com o cliente compilado: 76/76 respostas `200`, mediana 6,2ms, p95 20,3ms, máx. 28,9ms.

### 3.3 Smoke test do Compose

Depois de `docker compose down -v`, um único `docker compose up -d` deixou `db`, `redis`, `minio` e `mailpit` em `healthy`, `nestjs-api` e `video-worker` em `Up` (log `video-worker started`) e `minio-init` em `Exited (0)` (buckets `streamtube` e `streamtube-test` criados). Depois de `npm run migration:run`, o e2e do pipeline passou no ambiente zerado (2/2).

Outras verificações manuais registradas: com o Redis parado, o `complete` respondeu `PROCESSING` em ~5s (timeout do enqueue) e o reconciler recuperou o vídeo no cron seguinte; com o MinIO parado, o job foi para `delayed` (30s) e o retry levou o vídeo a `READY`.

## 4. Validação

### 4.1 Planejamento

| Etapa | Veredito |
|---|---|
| 1 Research (decisões técnicas) | APROVADO, 1 ciclo |
| 2-3 Contexto e resolução | validador independente não executado; merge a pedido do responsável (`3e0f878`) |
| 4 Build (plano) | APROVADO em 5 ciclos (limite de 3 estendido pelo responsável); ciclos 1 a 4 reprovados com 2 bloqueantes cada, todos corrigidos |

Exemplos de bloqueantes do plano: URLs assinadas para `localhost:9000` inalcançáveis de dentro dos containers (resolvido com `--storage-connect`); `ThrottlerGuard` global bloqueando as rotas de vídeo; `@Generated` em `seq` quebrando `public_id = Sqids(seq)`; ação de lifecycle não suportada pelo MinIO.

### 4.2 Ciclo 1 (implementação)

Um subagente independente por SI (análise estática) mais uma verificação final.

- Verificação final: APROVADO (281 testes unit+integration, 82 e2e, 5 e2e de vídeo; tsc, lint, openapi e build OK).
- SI-03.1 a 03.11 e 03.13: APROVADO COM RESSALVAS, sem bloqueantes.
- **SI-03.12: REPROVADO.** O AC de RSS tinha sido marcado como coberto sem medição do npm script real (ver 3.2). Resolvido com a execução em JS compilado e a flag de semi-space.

### 4.3 Ciclo 2

Base: commit `b063871`. SI-03.1 APROVADO; SI-03.2 a 03.13 APROVADO COM RESSALVAS, nenhum bloqueante. A SI-03.12 foi aprovada. Verificação final APROVADA (tsc, lint, `openapi:export` sem diff, build e `tsc -p tsconfig.scripts.json` OK).

### 4.4 Como foi executado

- Validadores sempre subagentes independentes, sem contexto da implementação.
- Validadores estáticos rodaram num worktree git isolado, sem tocar na árvore de trabalho.
- Os testes rodaram só no agente de verificação final, para não compartilhar o banco de teste entre agentes.

## 5. Correções (bugfix/*)

Cada branch foi implementada por um subagente e revisada por outro subagente independente (APROVADO COM RESSALVAS nas revisões registradas, sem bloqueantes). As branches saíram da `feature/phase-03-videos` e **foram mantidas**, porque serão enviadas ao upstream.

| Branch | Problema | Correção | Commit / merge |
|---|---|---|---|
| `bugfix/upload-body-limit` | `complete` com ~2.001 pares `{part_number, etag}` (~120kb) passava dos 100kb padrão do Express e a API respondia `413` (achado na prova de 10GB) | `JSON_BODY_LIMIT = '2mb'` em `main.ts` e no helper e2e; teste de regressão | `b718dd4` / `63391bc` |
| `bugfix/openapi-dto-schemas` | Todos os DTOs saíam com `properties: {}` no `openapi.json` desde a Fase 02: o `openapi:export` rodava em ts-node puro, sem o transformer do plugin do `@nestjs/swagger` | Hook `scripts/register-swagger-ts-node.js` registra o ts-node com o transformer, com as opções do `nest-cli.json`; saída idêntica à do build | `685ec96` / `461b0ad` |
| `bugfix/video-upload-abort` | `abort` apagava sem condição (corrida com `complete`), `NoSuchUpload` virava `500`, e o cliente nunca chamava o abort em falha definitiva | `deleteDraft` só com `status = 'DRAFT'` (senão 409 `VIDEO_NOT_IN_DRAFT`); `NoSuchUpload` no abort é sucesso; cliente chama `DELETE` em best-effort | `cea6432` / `2ee8d7a` |
| `bugfix/upload-client-robustness` | Qualquer `403` era tratado como URL expirada (loop infinito em `SignatureDoesNotMatch`), sem timeout de socket, `--concurrency` sem validação | 403 logo após renovar falha de vez com mensagem clara; timeout de inatividade de 60s por PUT, com `ReadStream` destruído; `--concurrency` só 1 a 32 | `ae6af38` / `d30afeb` |

Contagem de testes ao fim de cada correção: `video-upload-abort` 297 unit+integration; `upload-client-robustness` 317 unit+integration, 83 e2e, 5 e2e de vídeo.

Os registros em `progress.md` foram feitos nos commits `b063871`, `9df475b` e `ca230fa`.

## 6. Desvios em relação ao plano

- **TD-04 (lifecycle).** O TD pede lifecycle de bucket para abortar multiparts incompletos após 1 dia. O MinIO não implementa `AbortIncompleteMultipartUpload`. Foi usado `MINIO_API_STALE_UPLOADS_EXPIRY=24h`, com o mesmo efeito. A revisão formal do TD ficou para o fechamento da fase, para não invalidar `context.md`, `validation.md` e o plano por mtime.
- **Imagens MinIO.** `minio/minio` e `minio/mc` não são mais publicadas. Por escolha do usuário, foram usadas `bitnamilegacy/minio` e `bitnamilegacy/minio-client` (mesmo binário, imagens congeladas).
- **Versões das libs.** `@nestjs/bullmq@12` e `@nestjs/schedule@12` são ESM-only e quebram o Jest (CJS). Trocadas por `@nestjs/bullmq@^11.0.5` e `@nestjs/schedule@^6.1.3`. O `ioredis@^5.11.1` foi instalado explicitamente (peer opcional no bullmq v6).
- **`DEFAULT nextval` removido da migration (SI-03.5).** O TypeORM lê esse default como coluna `increment` e o `synchronize` dos testes dropava a sequence. A migration `CreateVideos` foi editada (só existia local, sem push); a sequence segue com `OWNED BY videos.seq`.
- **`upload:video` não usa mais ts-node.** Primeiro `ts-node -T`, depois JS compilado (`tsconfig.scripts.json`, saída em `dist-scripts/`) com `node --max-semi-space-size=1`.
- **`mc ready` substituído.** A readiness do MinIO é descrita pelo healthcheck do Compose e pelo `minio-init` em `Exited (0)`.
- **`dist-worker` e `.dockerignore`.** `tsconfig.build.json` passou a excluir `dist-worker`; foi criado um `.dockerignore` básico.
- **Nome do envelope de erro.** O plano cita `ApiErrorEnvelopeDto`; a classe existente é `ApiErrorEnvelope` e foi usada.
- **Ordem do `bugfix/upload-body-limit`.** Saiu da `feature`, não da `dev`, porque o bug só existe no endpoint da Fase 03.
- Correções de SIs anteriores feitas durante a fase: caminho de `setupFiles` em `jest-e2e.json` (SI-03.1), `DROP TABLE` em paralelo causando deadlock em `migrations.integration-spec.ts` (SI-03.3), e grafo de entidades do `WorkerModule` (SI-03.4).

## 7. Pendências e follow-ups

Dos 21 follow-ups em `progress.md`, os 1, 2 e 3 estão resolvidos. Os demais continuam abertos.

### Mais relevantes

1. **`.dockerignore` (FU 9).** Não lista `.tmp-10gb` nem `dist-scripts`. Um `docker compose build` enviaria o arquivo de 10GB ao contexto de build.
2. **Thumbnail vazia pode chegar a `READY` (FU 10).** Se o ffmpeg sai com 0 sem gerar frame, `extractFrame` devolve Buffer vazio e o vídeo vira `READY` com thumbnail de 0 bytes.
3. **Janela residual no abort (FU 18).** Se o `CompleteMultipartUpload` terminou mas o `transitionStatus` ainda não rodou, o abort apaga a linha DRAFT e o objeto montado fica órfão em `videos/<uuid>/source`. Gravidade baixa (mesmo dono, janela de uma query). Opções: sweeper de objetos sem linha, ou serializar abort/complete.
4. **Documentação do plano (FU 7 e 15).** O plano e a entrada da SI-03.3 ainda citam `DEFAULT nextval`; o plano ainda descreve `upload:video` com ts-node. A revisão formal do TD-04 também segue pendente.

### Demais, por tema

- **Estados presos e robustez do worker**
  - FU 4: falha do `transitionStatus` após `complete` deixa o vídeo em DRAFT; objeto `source` ausente faz o worker repetir para sempre; `READY` sem objeto ou com `thumbnail_key` nulo gera `500`.
  - FU 10: JSON truncado do ffprobe repete para sempre; stdout/stderr do ffmpeg sem teto.
  - FU 14: falha de pré-assinatura após o insert deixa DRAFT e multipart órfãos; e2e deixam ~16 multiparts abertos por execução no bucket de teste.
- **Fila e reconciler (FU 5):** `hasActiveJob` sem timeout, `updated_at` sem time zone comparado a `Date` do Node, `findStaleProcessing` sem `LIMIT`.
- **`complete` concorrente (FU 13):** a segunda requisição recebe 400 `INVALID_UPLOAD_PARTS` em vez do 409 `VIDEO_NOT_IN_DRAFT` do contrato.
- **Memória da API (FU 6):** RSS fica em ~340 MiB depois de um `initiate` grande; investigar heap retido pela pré-assinatura.
- **OpenAPI (FU 12):** `GET /videos/{id}` declara Bearer obrigatório apesar do `@OptionalAuth`; `@ApiProduces` faz erros 404/416 de mídia aparecerem com content type de vídeo; `status` sai como `{"type":"object"}`; `metadata.ts` e `loadPluginMetadata` são código morto.
- **Cliente de upload**
  - FU 15: AC de RSS depende de flag de runtime sem teste automatizado; `scripts/` fora do lint.
  - FU 19: parte em voo continua até `maxAttempts` antes do abort; `createHttpApi().abort` sem teste.
  - FU 20 e 21: teste de timeout de conexão depende da rede descartar o SYN; teste "share one renewal" não é determinístico.
- **Testes e infraestrutura de teste**
  - FU 8 e 16: lacunas em `video-pipeline.e2e-spec.ts` (status do login, polling sem limite), cron com flag ligada, defaults de config sem teste.
  - FU 11: `npm test` sem `--runInBand` pode falhar de forma intermitente por causa do `DROP TABLE` em `migrations.integration-spec.ts` (a suíte oficial usa `--runInBand`).
- **Docs (FU 7 e 17):** README sem checagem de readiness do MinIO; `DB_HOST=localhost` default em `env.validation.ts` contradiz a regra do Compose; `progress.md` mistura rodadas e unidades MB/MiB na SI-03.13 e tem uma observação desatualizada na SI-03.6.

## 8. Lições do processo

- Uma afirmação feita à mão ("AC de RSS coberto") estava errada e só foi pega pelo validador independente da SI-03.12. A medição passou a usar o npm script real.
- Medir o comando que o usuário roda importa: a mesma lógica dava 162–226MB em ts-node e 108,9 MiB em JS compilado com a flag. O número do protótipo não valia para o script final.
- A prova de 10GB achou bugs que testes pequenos não pegam: o limite de 100kb do body no `complete` e o disco cheio do Docker.
- Validadores estáticos num worktree isolado não interferiram na árvore de trabalho.
- O banco de teste é compartilhado, então os testes só rodam de forma serializada (`--runInBand`, e só no agente de verificação final).

## 9. Estado final do repositório

- Branch `dev` em `4019624` (merge da `feature/phase-03-videos`), local, **sem push**. Árvore limpa no início desta tarefa.
- Branches envolvidas, todas mantidas: `feature/phase-03-videos`, `bugfix/upload-body-limit`, `bugfix/openapi-dto-schemas`, `bugfix/video-upload-abort`, `bugfix/upload-client-robustness`. As quatro `bugfix/*` serão enviadas ao upstream.
- `nestjs-project/.tmp-10gb/video-10gb.mp4` (10.489.279.614 bytes) foi mantido no disco e está no `.gitignore`. Ele ainda não está no `.dockerignore` (FU 9).
