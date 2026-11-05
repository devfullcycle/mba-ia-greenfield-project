# Desafio 5 — StreamTube Fase 03: plano detalhado

Status em 04/11: **pendente, plano pronto, falta começar pelo setup.** Enunciado lido na plataforma e base lida no repositório `mba-ia-greenfield-project` (Fases 01 e 02, workflow em `.claude/`, `compose.yaml` só com API, Postgres e Mailpit). Decisões fechadas em 05/11 (ver abaixo).

## O que a entrega precisa provar

O desafio é de backend e avalia o **processo** tanto quanto o resultado. Há 8 motivos de reprovação automática, e todos viram item de checagem abaixo:

- pular o workflow (research → plan-context → plan-validate ↔ plan-resolve → plan-build → implement) ou seus artefatos
- plano sem SIs ou sem Technical Specs, ou `validation.md` que não fecha em `clean`
- passar o arquivo de 10GB pela API de forma que trave o sistema
- fila, worker e storage que não sobem de verdade no Compose
- `tsc` com erro, lint quebrado ou suíte vermelha
- commit direto na `main`
- `CLAUDE.md` inconsistente com o código
- usar outra ferramenta sem portar a fundação (não se aplica: uso Claude Code)

## Decisões fechadas (grill de 05/11)

Fechadas em entrevista em 05/11. A skill `research` deve registrá-las no documento de decisões com opções e trade-offs, conferindo as versões das libs via context7 (BullMQ, `@nestjs/bullmq`, AWS SDK v3, Sqids).

1. **Repositório:** usar este fork (`brunousml/mba-ia-greenfield-project`), que já tem o frontend. Fork público. Branch `dev` ainda **não existe**: criar a partir da `main` no setup. Todo trabalho em `feature/*` a partir da `dev`.
2. **Cliente de upload:** script Node `scripts/upload-video.ts` como SI própria. Lê o arquivo em stream parte a parte, faz PUT nas URLs pré-assinadas, guarda os ETags, chama o `complete` e renova URLs expiradas. Serve para a prova de 10GB e para o e2e.
3. **Streaming e download:** proxy na API (`pipe` sem buffer, repassando `Range` e devolvendo `206`). O download usa o mesmo caminho com `Content-Disposition: attachment`. O redirect pré-assinado fica anotado como evolução para quando houver CDN.
4. **Fila:** BullMQ + Redis, sem DLQ separada (os jobs `failed` do BullMQ fazem esse papel).
5. **Worker:** serviço `video-worker` no Compose, com `Dockerfile.worker` próprio que já traz FFmpeg/ffprobe e `npm ci` no build, e volume anônimo em `node_modules`. Subir exige só executar o worker. Mesma base de código, entrypoint `src/worker.ts` com `createApplicationContext(WorkerModule)`, sem HTTP.
6. **Entidade `Video`** (tabela `videos`): `id` uuid, `seq` bigint (sequence), `public_id` único, `channel_id` FK com cascade, `title`, `status` (`DRAFT`/`PROCESSING`/`READY`/`ERROR`), `original_filename`, `mime_type`, `size_bytes` (bigint com transformer para number), `storage_key`, `thumbnail_key`, `upload_id`, `duration_seconds`, `width`, `height`, `codec`, `error_reason` e timestamps. `description` e `visibility` ficam para a Fase 04.
7. **Link público sem colisão:** `public_id = Sqids(seq)` com alfabeto embaralhado e mínimo de 10 caracteres. É bijetor, então a unicidade vale por construção; o índice único fica como rede de segurança.
8. **Contrato de upload:** `POST /videos/uploads` (valida `video/*` e ≤ 10GB, cria `DRAFT`, devolve todas as URLs das partes com validade de 6h), `POST /videos/:id/uploads/parts` (renova URLs), `POST /videos/:id/uploads/complete` e `DELETE /videos/:id/uploads` (abort). Parte calculada entre 5MB e 100MB. Lifecycle do bucket aborta multipart incompleto depois de 1 dia.
9. **Processamento:** ffprobe e ffmpeg leem a URL pré-assinada interna, sem baixar o arquivo. Thumbnail em `min(10% da duração, duração − 0,1s)`. Timeout de 10 minutos por processo FFmpeg. Job idempotente: só processa vídeo em `PROCESSING`.
10. **Falhas:** falha de infraestrutura **nunca** marca o vídeo como `ERROR`. O job é reprocessado sem limite, com backoff exponencial (30s, dobrando, teto de 1h). Só falha permanente (arquivo inválido, sem stream de vídeo, sem duração) usa `UnrecoverableError` e vai para `ERROR` com `error_reason`. Na dúvida, a falha conta como infra. O classificador é uma função pura com teste unitário. O `complete` grava `PROCESSING` antes de enfileirar e responde `202` mesmo com o Redis fora. Um reconciliador roda a cada 5 minutos e reenfileira vídeos em `PROCESSING` sem job há mais de 15 minutos (`jobId = videoId` evita duplicar).
11. **Authorization Matrix:** as escritas de upload exigem autenticação e ser o dono (anônimo recebe 401; vídeo alheio, 404). Metadados: o dono vê qualquer status, os demais só `READY`. Stream, download e thumbnail: só `READY`, inclusive para o dono. Vídeo alheio ou fora de `READY` responde 404, não 403. A listagem "meus vídeos" fica para a Fase 04.
12. **Isolamento dos testes:** bucket `streamtube-test` e prefixo BullMQ `streamtube-test`. O e2e de vídeo sobe o `WorkerModule` dentro do processo do Jest, no container do worker (`npm run test:e2e:video`), com FFmpeg real. Fixtures: um MP4 de cerca de 1MB e um `.mp4` falso. O smoke test do Compose e a prova de 10GB são manuais e ficam registrados no `progress.md`.
13. **Endpoints do MinIO:** `S3_ENDPOINT=http://minio:9000` para as operações internas (API, proxy e worker) e `S3_PUBLIC_ENDPOINT=http://localhost:9000` só para assinar os PUTs de parte. Dois `S3Client` com `forcePathStyle`. No `.env` de teste, o endpoint público é `minio:9000`. O serviço `minio-init` (`minio/mc`) cria o bucket e o lifecycle.

### Fora de escopo (virar tarefa separada)

- API subir sozinha no Compose (hoje o container sobe parado, com `tail -f`)
- banco de teste separado (`streamtube_test`); hoje os testes usam o banco de dev
- limpeza no banco dos rascunhos abandonados
- descarte da alteração em `next-frontend/package-lock.json`

## Plano de execução

1. **Setup (cerca de meio dia).** Usar o fork existente, `docker compose up -d`, instalar dependências, rodar migrations e confirmar a suíte atual verde. Conferir se existe a branch `dev` (se não, criar a partir da `main`). Todo trabalho em `feature/*`, nada direto na `main`.
2. **Research.** Skill `research` gera `docs/decisions/technical-decisions-phase-03-videos.md` no formato dos documentos de decisão existentes (opções, trade-offs, recomendação por decisão). Aqui valem a pena duas horas extras, porque é o que alimenta o resto.
3. **Planejamento.** `plan-context` → `plan-validate` ↔ `plan-resolve` (repetir até `clean`, com `library-refs.md` via context7) → `plan-build`, que gera `phase-03-videos.md` com SIs (SI-03.x), Technical Specs (Data Model, API Contracts, Authorization Matrix, Error Catalog, Events/Messages), Dependency Map e Deliverables. Referência de formato: `docs/phases/phase-02-auth/`.
4. **Implementação com `implement`, SI a SI**, cada uma só avança com a suíte do passo verde e atualiza o `progress.md`. Fatiamento acordado em 05/11:
   - SI-03.1: infra (`minio`, `minio-init`, `redis`, `video-worker`, `Dockerfile.worker`, config validado)
   - SI-03.2: entidade `Video` e migration (sequence, `public_id`, enum, FK com cascade, transformer), util Sqids (depende de 03.1)
   - SI-03.3: `StorageModule` (dois clientes, multipart, presign, head, stream por Range, thumbnail) (depende de 03.1)
   - SI-03.4: endpoints de upload (`initiate`, renovar partes, `complete`, abort) e produtor BullMQ (depende de 03.2 e 03.3)
   - SI-03.5: script cliente `scripts/upload-video.ts` (depende de 03.4)
   - SI-03.6: worker (entrypoint, processor, timeout, classificador de falha, backoff infinito, `UnrecoverableError`) (depende de 03.2, 03.3 e 03.4)
   - SI-03.7: reconciliador de `PROCESSING` parado (depende de 03.6)
   - SI-03.8: metadados, stream (206), download e thumbnail com a Authorization Matrix (depende de 03.2 e 03.3)
   - SI-03.9: e2e de ponta a ponta, smoke test do Compose, prova de 10GB, `CLAUDE.md` (fila = BullMQ, seção de vídeos) e README (depende de todas)
5. **Fechamento.** Definition of Done completa (`npm test`, `npm run test:e2e`, `npx tsc --noEmit` com código 0 e `npm run lint`), `CLAUDE.md` atualizado com a seção de vídeos e conferido contra o código, revisão item a item dos critérios de aceite, push e envio da URL do fork.

## Testes

- sufixos do projeto: `*.spec.ts` (unit), `*.integration-spec.ts` (banco e serviços reais) e `*.e2e-spec.ts` (supertest)
- o enunciado pede infra real: MinIO, Redis e worker do Compose exercitados pelos testes, sem mock do que dá para rodar de verdade
- o upload de 10GB: validar a estratégia multipart de ponta a ponta com um arquivo grande uma vez, manualmente, registrando no `progress.md`; na suíte, usar vídeo pequeno com partes pequenas

## Riscos

- **Endpoint do MinIO** (interno x público nas URLs pré-assinadas): decidir cedo, senão o upload funciona só dentro do Docker.
- **Tamanho do desafio** (estimativa de 3,5 semanas): o plano é o que segura. Se o `validation.md` não fechar em `clean` na segunda rodada, o problema está nas decisões, e não vale começar a implementar.
- **Espaço em disco e tempo** com arquivos de vários GB: preparar o arquivo de teste uma única vez.
- **Skills interativas**: `plan-resolve` pergunta ao usuário; reservar tempo para responder.
- **Consistência do `CLAUDE.md`**: conferir cada arquivo e endpoint citado antes do push.

## Checklist de entrega

- [x] Fork público de `mba-ia-greenfield-project`
- [ ] `docs/decisions/technical-decisions-phase-03-videos.md`
- [ ] `docs/phases/phase-03-videos/` com `context.md`, `validation.md` (clean), `library-refs.md`, `phase-03-videos.md` e `progress.md`
- [ ] Compose com storage, fila e worker subindo junto com o backend
- [ ] Migration e entidade de vídeo ligada ao canal
- [ ] Upload multipart direto ao storage, rascunho no início, processamento e thumbnail automáticos
- [ ] URL única, streaming (Range e 206) e download
- [ ] `npm test`, `npm run test:e2e`, `npx tsc --noEmit` e `npm run lint` verdes
- [ ] Git Flow respeitado e `CLAUDE.md` atualizado
- [ ] URL do fork enviada na plataforma

## Próximo passo

Fazer o setup (passo 1) no fork existente. Depois, abrir o Claude Code dentro do fork e rodar a skill `research`.
