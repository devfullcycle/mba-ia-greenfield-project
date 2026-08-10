# API Contract: Videos

**Date**: 2026-06-27 | **Data Model**: [data-model.md](../data-model.md)

Contratos REST de todos os endpoints de vídeo introduzidos na Fase 03. Segue os padrões existentes do projeto: rotas em plural, DTOs validados, respostas de erro no envelope `ApiErrorEnvelope`.

---

## Autenticação

- Endpoints marcados com `[AUTH]` requerem JWT válido no header `Authorization: Bearer {token}`
- Endpoints marcados com `[PUBLIC]` são acessíveis sem autenticação (`@Public()` no controller)
- Endpoints marcados com `[OWNER]` requerem autenticação E que o usuário seja dono do canal ao qual o vídeo pertence

---

## 1. Iniciar Upload

**`POST /videos`** `[AUTH]`

Pré-registra o vídeo como `draft` e retorna a URL pré-assinada para upload direto ao MinIO.

### Request Body

```json
{
  "title": "string (1-255 chars, obrigatório)",
  "file_size": "integer (bytes, obrigatório, max: 10737418240 = 10 GB)",
  "mime_type": "string (obrigatório, deve começar com 'video/')"
}
```

### Responses

**`201 Created`**
```json
{
  "id": "uuid",
  "status": "draft",
  "upload_url": "string (URL pré-assinada para PUT direto ao MinIO, válida por 15 min)",
  "storage_key": "string (chave do objeto no storage, ex.: 'videos/{uuid}/original.mp4'; mesmo valor persistido na entidade Video)"
}
```

**`400 Bad Request`** — Validação falhou (título vazio, tamanho inválido, mime_type não é vídeo)
```json
{ "$ref": "ApiErrorEnvelope" }
```

**`401 Unauthorized`** — Token ausente ou inválido
```json
{ "$ref": "ApiErrorEnvelope" }
```

**`403 Forbidden`** — Usuário autenticado não tem canal ativo
```json
{ "$ref": "ApiErrorEnvelope" }
```

---

## 2. Confirmar Upload Concluído

**`POST /videos/:id/upload-complete`** `[OWNER]`

Sinaliza que o cliente concluiu o envio do arquivo ao storage. A API enfileira a tarefa de processamento **antes** de atualizar o status para `processing`; se o enfileiramento falhar (Redis indisponível), retorna 500 e o status permanece `draft` para que o cliente possa retentar.

### Path Parameters

| Param | Tipo | Descrição |
|-------|------|-----------|
| `id` | UUID | Identificador do vídeo |

### Request Body

Nenhum body necessário.

### Responses

**`200 OK`**
```json
{
  "id": "uuid",
  "status": "processing"
}
```

**`400 Bad Request`** — Vídeo não está em status `draft` (ex.: já foi confirmado)
```json
{ "$ref": "ApiErrorEnvelope" }
```

**`401 Unauthorized`**
```json
{ "$ref": "ApiErrorEnvelope" }
```

**`403 Forbidden`** — Vídeo pertence a outro canal
```json
{ "$ref": "ApiErrorEnvelope" }
```

**`404 Not Found`** — Vídeo não encontrado
```json
{ "$ref": "ApiErrorEnvelope" }
```

---

## 3. Detalhes do Vídeo (público)

**`GET /videos/:id`** `[PUBLIC]`

Retorna os metadados do vídeo. Acessível por qualquer usuário (autenticado ou anônimo). Pode ser usado pelo cliente para polling do status durante o processamento.

### Path Parameters

| Param | Tipo | Descrição |
|-------|------|-----------|
| `id` | UUID | Identificador do vídeo |

### Responses

**`200 OK`**
```json
{
  "id": "uuid",
  "title": "string",
  "status": "draft | processing | ready | error",
  "thumbnail_url": "string | null (URL HTTP completa da thumbnail, montada pelo servidor a partir de thumbnail_key; null enquanto não processado)",
  "duration_seconds": "integer | null",
  "processing_metadata": "{ width: integer, height: integer, codec: string, bitrate_kbps: integer } | null",
  "channel_id": "uuid",
  "created_at": "ISO 8601 datetime",
  "updated_at": "ISO 8601 datetime"
}
```

**`404 Not Found`** — Vídeo não encontrado
```json
{ "$ref": "ApiErrorEnvelope" }
```

---

## 4. Streaming do Vídeo (público)

**`GET /videos/:id/stream`** `[PUBLIC]`

Serve o arquivo de vídeo para reprodução com suporte a range requests. O cliente pode solicitar um intervalo de bytes via header `Range` para permitir navegação no conteúdo sem download completo.

### Path Parameters

| Param | Tipo | Descrição |
|-------|------|-----------|
| `id` | UUID | Identificador do vídeo |

### Request Headers (opcionais)

| Header | Exemplo | Descrição |
|--------|---------|-----------|
| `Range` | `bytes=0-1048575` | Intervalo de bytes solicitado (opcional) |

### Responses

**`200 OK`** — Sem header `Range` ou range cobrindo o arquivo completo
```
Content-Type: video/{format}
Content-Length: {total_bytes}
Accept-Ranges: bytes

[binary stream]
```

**`206 Partial Content`** — Range request válido
```
Content-Type: video/{format}
Content-Range: bytes {start}-{end}/{total}
Accept-Ranges: bytes
Content-Length: {range_length}

[binary stream do intervalo solicitado]
```

**`404 Not Found`** — Vídeo não encontrado
```json
{ "$ref": "ApiErrorEnvelope" }
```

**`409 Conflict`** — Vídeo não está em status `ready`
```json
{ "$ref": "ApiErrorEnvelope" }
```

**`416 Range Not Satisfiable`** — Intervalo solicitado está além do tamanho do arquivo
```json
{ "$ref": "ApiErrorEnvelope" }
```

---

## 5. Download do Vídeo (autenticado)

**`GET /videos/:id/download`** `[AUTH]`

Permite que um usuário autenticado baixe o arquivo completo. Retorna o arquivo diretamente (sem redirecionar para o storage).

### Path Parameters

| Param | Tipo | Descrição |
|-------|------|-----------|
| `id` | UUID | Identificador do vídeo |

### Responses

**`200 OK`**
```
Content-Type: video/{format}
Content-Disposition: attachment; filename="{title}.{ext}"
Content-Length: {total_bytes}

[binary stream completo]
```

**`401 Unauthorized`**
```json
{ "$ref": "ApiErrorEnvelope" }
```

**`404 Not Found`** — Vídeo não encontrado
```json
{ "$ref": "ApiErrorEnvelope" }
```

**`409 Conflict`** — Vídeo não está em status `ready`
```json
{ "$ref": "ApiErrorEnvelope" }
```

---

## 6. Listar Vídeos do Canal

**`GET /channels/:channelId/videos`** `[OWNER]`

Lista os vídeos do canal de forma paginada, ordenados por data de criação decrescente. Acessível apenas pelo dono do canal.

### Path Parameters

| Param | Tipo | Descrição |
|-------|------|-----------|
| `channelId` | UUID | Identificador do canal |

### Query Parameters

| Param | Tipo | Padrão | Descrição |
|-------|------|--------|-----------|
| `page` | integer | `1` | Número da página (1-indexed) |
| `limit` | integer | `20` | Itens por página (máx. 100) |

### Responses

**`200 OK`**
```json
{
  "items": [
    {
      "id": "uuid",
      "title": "string",
      "status": "draft | processing | ready | error",
      "created_at": "ISO 8601 datetime"
    }
  ],
  "total": "integer (total de itens no canal)",
  "page": "integer (página atual)",
  "limit": "integer (tamanho da página)",
  "has_next_page": "boolean"
}
```

**`401 Unauthorized`**
```json
{ "$ref": "ApiErrorEnvelope" }
```

**`403 Forbidden`** — Canal pertence a outro usuário
```json
{ "$ref": "ApiErrorEnvelope" }
```

**`404 Not Found`** — Canal não encontrado
```json
{ "$ref": "ApiErrorEnvelope" }
```

---

## 7. Atualizar Título do Vídeo

**`PATCH /videos/:id`** `[OWNER]`

Atualiza o título de um vídeo. O `id` (URL identifier) permanece inalterado.

### Path Parameters

| Param | Tipo | Descrição |
|-------|------|-----------|
| `id` | UUID | Identificador do vídeo |

### Request Body

```json
{
  "title": "string (1-255 chars, obrigatório)"
}
```

### Responses

**`200 OK`**
```json
{
  "id": "uuid",
  "title": "string (novo título)",
  "status": "draft | processing | ready | error",
  "updated_at": "ISO 8601 datetime"
}
```

**`400 Bad Request`** — Título vazio ou inválido
```json
{ "$ref": "ApiErrorEnvelope" }
```

**`401 Unauthorized`**
```json
{ "$ref": "ApiErrorEnvelope" }
```

**`403 Forbidden`** — Vídeo pertence a outro canal
```json
{ "$ref": "ApiErrorEnvelope" }
```

**`404 Not Found`** — Vídeo não encontrado
```json
{ "$ref": "ApiErrorEnvelope" }
```

---

## 8. Excluir Vídeo

**`DELETE /videos/:id`** `[OWNER]`

Remove o vídeo em qualquer status. Remove o registro do banco, os arquivos do storage (vídeo + thumbnail se existirem) e cancela qualquer job pendente na fila.

### Path Parameters

| Param | Tipo | Descrição |
|-------|------|-----------|
| `id` | UUID | Identificador do vídeo |

### Responses

**`204 No Content`** — Vídeo deletado com sucesso (sem body)

**`401 Unauthorized`**
```json
{ "$ref": "ApiErrorEnvelope" }
```

**`403 Forbidden`** — Vídeo pertence a outro canal
```json
{ "$ref": "ApiErrorEnvelope" }
```

**`404 Not Found`** — Vídeo não encontrado
```json
{ "$ref": "ApiErrorEnvelope" }
```

---

## Resumo dos Endpoints

| Método | Rota | Auth | Descrição |
|--------|------|------|-----------|
| `POST` | `/videos` | AUTH | Iniciar upload (pré-registro + URL pré-assinada) |
| `POST` | `/videos/:id/upload-complete` | OWNER | Confirmar upload concluído |
| `GET` | `/videos/:id` | PUBLIC | Detalhes do vídeo |
| `GET` | `/videos/:id/stream` | PUBLIC | Streaming com range requests |
| `GET` | `/videos/:id/download` | AUTH | Download do arquivo completo |
| `GET` | `/channels/:channelId/videos` | OWNER | Listar vídeos do canal (paginado) |
| `PATCH` | `/videos/:id` | OWNER | Atualizar título |
| `DELETE` | `/videos/:id` | OWNER | Excluir vídeo |
