# Phase 03 — Contexto da Fase de Vídeos

## Escopo

A Fase 03 adiciona ao backend NestJS o fluxo completo de upload e processamento de vídeos. O frontend permanece fora do escopo.

## Fontes rastreáveis

- `docs/project-plan.md`, seção **Fase 03 — Upload e Processamento de Vídeos**.
- Enunciado do desafio **Continuando o StreamTube com IA — Fase 03**, consultado no portal Full Cycle em 13/11/2026.
- `docs/decisions/technical-decisions-phase-03-videos.md`.
- Código existente em `nestjs-project/src/`, após incorporar a branch remota `origin/feature/phase-02-auth`.
- `docs/phases/phase-02-auth.progress.md`, que registra a Fase 02 como concluída (18/18 SIs).

## Estado de entrada

- Backend NestJS 11 + TypeScript + Express.
- TypeORM e PostgreSQL 17.
- Autenticação JWT global, canais associados a usuários e migrations versionadas.
- Mailpit existente na infraestrutura local.
- A branch `dev` original não continha os módulos da Fase 02; a implementação foi incorporada localmente de `origin/feature/phase-02-auth` na branch `feature/phase-03-videos`, com autorização explícita.

## Capacidades da fase

1. Object storage compatível com S3 usando MinIO no desenvolvimento.
2. Upload multipart direto ao storage por URLs pré-assinadas.
3. Pré-cadastro do vídeo como rascunho sem transportar o arquivo pela API.
4. Fila BullMQ sobre Redis.
5. Worker separado em container, consumindo jobs.
6. Extração de metadados com `ffprobe`.
7. Geração de thumbnail com FFmpeg.
8. URL pública única baseada em UUID.
9. Streaming e download com suporte a `Range` e `206 Partial Content`.
10. Ciclo de estados `DRAFT`, `UPLOADING`, `UPLOADED`, `PROCESSING`, `READY`, `ERROR` e `CANCELLED`.

## Limites e não objetivos

- O arquivo de vídeo não deve ser enviado integralmente através da API.
- O frontend de reprodução não será implementado nesta fase.
- Não alterar fluxos de autenticação da Fase 02 sem necessidade direta para vídeos.
- Não publicar, fazer fork ou submeter o repositório nesta etapa.

## Dependências externas e infraestrutura

- PostgreSQL: persistência de vídeos e relacionamento com canais.
- MinIO: objetos fonte e thumbnails.
- Redis: backend da fila BullMQ.
- Worker com FFmpeg/ffprobe: processamento assíncrono.
- Docker Compose: execução local integrada.

## Critérios operacionais

- Jobs devem ser repetíveis e ter tratamento de falha.
- O status persistido deve representar a etapa observável do processamento.
- Objetos e jobs devem usar identificadores derivados do UUID do vídeo.
- A API deve responder sem manter o arquivo de 10 GB em memória.
- Testes devem cobrir unitário, integração com serviços reais e E2E conforme o guia NestJS do projeto.
