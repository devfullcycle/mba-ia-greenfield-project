# Data Model: Phase 03 — Upload e Processamento de Vídeos

**Date**: 2026-06-27 | **Plan**: [plan.md](plan.md)

---

## Entidade: Video

**Tabela**: `videos`

| Campo | Tipo | Nulável | Único | Descrição |
|-------|------|---------|-------|-----------|
| `id` | UUID | Não | Sim (PK) | Identificador único e identificador da URL — gerado automaticamente no pré-cadastro |
| `title` | varchar(255) | Não | Não | Título fornecido pelo criador; pode ser alterado (o `id` permanece) |
| `status` | enum | Não | Não | Ciclo de vida do vídeo: `draft` / `processing` / `ready` / `error` |
| `channel_id` | UUID (FK → channels.id) | Não | Não | Canal proprietário do vídeo; determinado no pré-cadastro |
| `storage_key` | varchar | Não | Não | Chave do arquivo de vídeo no object storage (ex.: `videos/{id}/original.mp4`); determinada e persistida no pré-registro (POST /videos), antes de gerar a URL pré-assinada |
| `thumbnail_key` | varchar | Sim | Não | Chave da thumbnail no object storage (ex.: `videos/{id}/thumbnail.jpg`); definida após processamento |
| `duration_seconds` | integer | Sim | Não | Duração em segundos extraída pelo worker; `null` enquanto não processado |
| `processing_metadata` | jsonb | Sim | Não | Metadados técnicos extraídos pelo worker; schema mínimo: `{ width, height, codec, bitrate_kbps }` |
| `error_cause` | varchar(2048) | Sim | Não | Causa da última falha; campo interno — não exposto ao usuário final; preenchido apenas quando `status = error` |
| `created_at` | timestamp | Não | Não | Timestamp de criação do registro |
| `updated_at` | timestamp | Não | Não | Timestamp da última atualização |

**Constraints**:
- `status` é um PostgreSQL `ENUM` com valores `draft`, `processing`, `ready`, `error`
- `channel_id` tem FK com ON DELETE RESTRICT (um canal não pode ser deletado enquanto tiver vídeos)
- `storage_key` é preenchido durante o pré-registro (POST /videos) — a API determina o caminho antes de gerar a URL pré-assinada; **nunca é nulo após a criação do registro**
- `title` tem no máximo 255 caracteres; deve ser não-vazio
- `error_cause` é campo interno: não retornado em respostas públicas; truncado em 2048 caracteres pelo worker se necessário

**Índices** (além do PK):
- `idx_videos_channel_id` — busca por canal (listagem, autorização)
- `idx_videos_channel_id_created_at (channel_id, created_at DESC)` — listagem paginada por data decrescente; a ordem dos campos e do sort é relevante para eficiência — o índice deve declarar `created_at DESC`
- `idx_videos_status` — filtragem por status (worker queries)

---

## Entidade Existente: Channel (referência)

**Tabela**: `channels` (não modificada nesta fase)

| Campo | Tipo | Descrição relevante |
|-------|------|---------------------|
| `id` | UUID | FK referenciada em `videos.channel_id` |
| `user_id` | UUID | Usado para verificar ownership: criador autenticado → `user.id` == canal.`user_id` |

**Relacionamento**: `Channel` 1 → N `Video` (OneToMany/ManyToOne)

---

## Mensagem de Fila: VideoProcessingJob

Publicada na fila `video-processing` quando o upload é confirmado (FR-004).

```typescript
interface VideoProcessingJob {
  videoId: string;         // UUID do vídeo a processar
  storageKey: string;      // Chave do arquivo no MinIO (ex.: "videos/{uuid}/original.mp4")
  bucketName: string;      // Nome do bucket MinIO
}
```

**Observações**:
- O worker usa `videoId` para atualizar o registro no banco após o processamento
- `storageKey` e `bucketName` são incluídos para evitar lookup extra no worker — o job é autossuficiente
- BullMQ serializa a mensagem como JSON; tipos primitivos apenas

---

## Máquina de Estados: Video.status

```
                    ┌────────────────────────────────────────────┐
                    │                                            │
             [POST /videos]                                      │
                    │                                            │
                    ▼                                            │
                ┌───────┐                                        │
                │ draft │  ◄── pré-registro no início do upload  │
                └───────┘                                        │
                    │                                            │
    [POST /videos/:id/upload-complete]                           │
                    │                                            │
                    ▼                                            │
            ┌────────────┐                                       │
            │ processing │  ◄── job enfileirado na fila          │
            └────────────┘                                       │
                    │                                            │
       ┌────────────┴────────────┐                               │
       │ success (all steps OK)  │ failure (3 retries exhausted) │
       ▼                         ▼                               │
   ┌───────┐                ┌───────┐                            │
   │ ready │                │ error │                            │
   └───────┘                └───────┘                            │
       │                        │                                │
       └──────── DELETE ─────────┘◄──────────────────────────────┘
                  (qualquer status pode ser deletado pelo dono)
```

**Transições permitidas**:

| De | Para | Gatilho |
|----|------|---------|
| `draft` | `processing` | Cliente chama `POST /videos/:id/upload-complete` |
| `processing` | `ready` | Worker conclui com sucesso todas as etapas |
| `processing` | `error` | Worker esgota 3 tentativas sem sucesso |

**Transições proibidas**:
- `ready` → qualquer outro status (estado final positivo; só pode ser deletado)
- `error` → qualquer outro status (estado final negativo; só pode ser deletado; sem retry manual nesta fase)
- `draft` → `ready` ou `error` (obrigatório passar por `processing`)

**Regra de idempotência do worker**: Antes de iniciar o processamento, o worker deve verificar se o status ainda é `processing`. Se o status já for `ready` ou `error` (job reprocessado por retry do BullMQ), o worker descarta a mensagem sem ação (evita duplo processamento — edge case da spec).

**Ordem de operações em `POST /videos/:id/upload-complete`**: O sistema deve enfileirar o job na fila BullMQ **antes** de atualizar o status do vídeo para `processing` no banco. Se o enfileiramento falhar (Redis indisponível), a API retorna 500 e o status permanece `draft` — o cliente pode retentar. Se o enfileiramento suceder mas a atualização do BD falhar, o worker encontrará o vídeo em `draft` e descartará o job pela regra de idempotência. O status `draft` é sempre o estado seguro de fallback.

---

## Resumo de Relacionamentos

```text
User ──1:1──► Channel ──1:N──► Video
                                  │
                                  ├── storage_key ──► MinIO bucket (video file)
                                  └── thumbnail_key ─► MinIO bucket (thumbnail)

Video ──publishes──► Queue (video-processing) ──► Worker ──► MinIO + DB update
```

---

## Migration

A tabela `videos` será criada via TypeORM CLI:

```bash
# Executado dentro do container API após adicionar a entidade
npm run migration:generate -- src/database/migrations/CreateVideos
npm run migration:run
```

O nome exato do arquivo incluirá o timestamp gerado pelo CLI (ex.: `1780000000000-CreateVideos.ts`). A migration criará:
1. ENUM type `video_status_enum`
2. Tabela `videos` com todos os campos acima
3. FK constraint para `channels.id`
4. Índices listados acima
