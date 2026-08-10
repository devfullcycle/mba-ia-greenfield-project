# Quickstart: Validação End-to-End — Phase 03

**Date**: 2026-06-27 | **Contratos**: [contracts/videos-api.md](contracts/videos-api.md) | **Modelo**: [data-model.md](data-model.md)

Guia para validar que a feature de upload e processamento de vídeos funciona corretamente. Use-o para verificar o golden path e os principais cenários de erro após a implementação.

---

## Pré-requisitos

1. Stack completa em execução: `docker compose up --build` (inclui API, worker, Redis e MinIO)
2. Usuário com canal criado (ou use o seed: `docker compose exec nestjs-api npm run seed`)
3. Token JWT válido obtido via `POST /auth/login`
4. Ferramenta de requisição HTTP (curl, httpie ou Insomnia) e `jq` para parsing JSON

```bash
# Obter token (substitua credenciais conforme o seed)
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"senha123"}' \
  | jq -r '.access_token')

# Confirmar token obtido
echo "Token: $TOKEN"
```

---

## Cenário 1: Golden Path (upload → processamento → streaming)

### Passo 1 — Iniciar upload e obter URL pré-assinada

```bash
RESPONSE=$(curl -s -X POST http://localhost:3000/videos \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Meu Primeiro Vídeo","file_size":10485760,"mime_type":"video/mp4"}')

echo $RESPONSE | jq .

VIDEO_ID=$(echo $RESPONSE | jq -r '.id')
UPLOAD_URL=$(echo $RESPONSE | jq -r '.upload_url')
echo "Video ID: $VIDEO_ID"
echo "Status esperado: draft"
```

**Resultado esperado**: `status: "draft"`, `upload_url` preenchida (URL do MinIO com assinatura)

### Passo 2 — Fazer upload direto ao MinIO

```bash
# Usar um arquivo de vídeo real para testar o worker (1-5 MB para agilidade)
curl -s -X PUT "$UPLOAD_URL" \
  -H "Content-Type: video/mp4" \
  --upload-file /caminho/para/video.mp4

echo "Upload ao MinIO: concluído"
```

**Resultado esperado**: HTTP 200 do MinIO (sem body)

### Passo 3 — Confirmar upload e disparar processamento

```bash
curl -s -X POST "http://localhost:3000/videos/$VIDEO_ID/upload-complete" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Resultado esperado**: `status: "processing"`

### Passo 4 — Polling até status `ready`

```bash
# Aguardar processamento (geralmente 5-30s dependendo do arquivo)
for i in {1..20}; do
  STATUS=$(curl -s "http://localhost:3000/videos/$VIDEO_ID" | jq -r '.status')
  echo "Tentativa $i: status = $STATUS"
  [[ "$STATUS" == "ready" ]] && break
  sleep 3
done
```

**Resultado esperado**: Status muda de `processing` para `ready`; `thumbnail_url` e `duration_seconds` preenchidos

### Passo 5 — Streaming com range request

```bash
# Solicitar os primeiros 1MB do vídeo
curl -s -o /dev/null -w "HTTP %{http_code} | Size: %{size_download} bytes\n" \
  -H "Range: bytes=0-1048575" \
  "http://localhost:3000/videos/$VIDEO_ID/stream"
```

**Resultado esperado**: HTTP 206, tamanho entre 0 e 1048576 bytes

### Passo 6 — Streaming sem range (arquivo completo)

```bash
curl -s -o /dev/null -w "HTTP %{http_code} | Size: %{size_download} bytes\n" \
  "http://localhost:3000/videos/$VIDEO_ID/stream"
```

**Resultado esperado**: HTTP 200, tamanho igual ao do arquivo original

---

## Cenário 2: Detalhes públicos (sem autenticação)

```bash
curl -s "http://localhost:3000/videos/$VIDEO_ID" | jq .
```

**Resultado esperado**: HTTP 200 com título, status, thumbnail_url, duration_seconds, channel_id — sem necessidade de token

---

## Cenário 3: Download autenticado

```bash
curl -s -o video_baixado.mp4 -w "HTTP %{http_code}\n" \
  -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/videos/$VIDEO_ID/download"
```

**Resultado esperado**: HTTP 200, arquivo `video_baixado.mp4` com o conteúdo completo

---

## Cenário 4: Download sem autenticação (deve falhar)

```bash
curl -s "http://localhost:3000/videos/$VIDEO_ID/download" | jq .
```

**Resultado esperado**: HTTP 401 com `ApiErrorEnvelope`

---

## Cenário 5: Listagem paginada do canal

```bash
# Obter channelId a partir do vídeo já criado no Cenário 1
CHANNEL_ID=$(curl -s "http://localhost:3000/videos/$VIDEO_ID" | jq -r '.channel_id')
echo "Channel ID: $CHANNEL_ID"

curl -s "http://localhost:3000/channels/$CHANNEL_ID/videos?page=1&limit=5" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Resultado esperado**: `items` com até 5 vídeos, `total`, `page: 1`, `has_next_page` correto

---

## Cenário 6: CRUD — editar título e excluir

```bash
# Editar título
curl -s -X PATCH "http://localhost:3000/videos/$VIDEO_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Título Atualizado"}' | jq .
# Esperado: título novo, id inalterado

# Excluir
curl -s -o /dev/null -w "HTTP %{http_code}\n" \
  -X DELETE "http://localhost:3000/videos/$VIDEO_ID" \
  -H "Authorization: Bearer $TOKEN"
# Esperado: HTTP 204

# Confirmar exclusão
curl -s "http://localhost:3000/videos/$VIDEO_ID" | jq .
# Esperado: HTTP 404
```

---

## Cenário 7: Validações de autorização (OWNER)

```bash
# Criar segundo usuário e obter token
TOKEN2=$(curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"outro@example.com","password":"senha123"}' \
  | jq -r '.access_token')

# Tentar deletar vídeo de outro canal com TOKEN2
curl -s -X DELETE "http://localhost:3000/videos/$VIDEO_ID" \
  -H "Authorization: Bearer $TOKEN2" | jq .
# Esperado: HTTP 403
```

---

## Cenário 8: Upload de arquivo não-vídeo (deve falhar)

```bash
curl -s -X POST http://localhost:3000/videos \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Foto","file_size":102400,"mime_type":"image/jpeg"}' | jq .
# Esperado: HTTP 400
```

---

## Cenário 9: Range inválido durante streaming

```bash
curl -s -o /dev/null -w "HTTP %{http_code}\n" \
  -H "Range: bytes=99999999999-99999999999" \
  "http://localhost:3000/videos/$VIDEO_ID/stream"
# Esperado: HTTP 416
```

---

## Verificação da infraestrutura

```bash
# MinIO acessível (console web)
# Abrir http://localhost:9001 no browser (credenciais do compose.yaml)

# Redis: verificar que as filas estão sendo consumidas
docker compose exec redis redis-cli LLEN bull:video-processing:wait
# Esperado: 0 (filas vazias se processamento concluído)

# Worker logs
docker compose logs video-worker --tail=50
# Esperado: linhas de processamento, sem erros fatais

# Testes automatizados (rodar após implementação)
docker compose exec nestjs-api npm run test         # unit
docker compose exec nestjs-api npm run test:integration  # integration
docker compose exec nestjs-api npm run test:e2e     # e2e
```

---

## Critérios de Aceitação Rápidos (checklist)

- [ ] Upload de arquivo de vídeo retorna URL pré-assinada válida e cria registro `draft`
- [ ] Confirmação de upload muda status para `processing` e job aparece no Redis
- [ ] Worker consome o job, gera thumbnail e preenche `duration_seconds`
- [ ] Status muda para `ready` após processamento bem-sucedido
- [ ] Endpoint de detalhe retorna dados completos sem autenticação
- [ ] Streaming com `Range` header retorna HTTP 206 com bytes corretos
- [ ] Download sem token retorna 401
- [ ] Download com token retorna arquivo completo
- [ ] Listagem retorna vídeos do canal em ordem decrescente com paginação
- [ ] Edição de título persiste e `id` permanece inalterado
- [ ] Exclusão remove registro + arquivos do MinIO + job pendente
- [ ] Acesso cruzado (outro usuário) retorna 403
- [ ] Upload de não-vídeo retorna 400
- [ ] Range inválido retorna 416
