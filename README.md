# StreamTube — Plataforma de Compartilhamento de Vídeos

Projeto da disciplina **Desenvolvimento de Aplicações de IA** do MBA de Engenharia de Software com IA da [Full Cycle](https://fullcycle.com.br).

Este é um projeto greenfield desenvolvido para demonstrar como construir uma aplicação do zero utilizando IA de forma adequada no processo de desenvolvimento.

## Professor

<a href="https://github.com/argentinaluiz">
    <img src="https://avatars.githubusercontent.com/u/4926329?v=4?s=100" width="100px;" alt=""/>
    <br />
    <sub>
        <b>Luiz Carlos</b>
    </sub>
</a>

---

## Quadro Branco

- [Quadro Branco](./whiteboard.png)

---

## 📋 Pré-requisitos

- Docker
- Node.js v25+
- npm

## 🏗️ Arquitetura

O projeto segue uma arquitetura baseada em containers:

- **Frontend** (Next.js) — Interface da plataforma
- **API** (Nest.js) — Regras de negócio e autenticação
- **Video Worker** (FFmpeg) — Processamento de vídeos em background
- **Database** (PostgreSQL) — Usuários, canais, vídeos, comentários, likes
- **Object Storage** (S3/MinIO) — Arquivos de vídeo e thumbnails
- **Message Queue** — Fila de processamento de vídeos
- **Email Service** (SMTP) — Confirmação de conta e recuperação de senha

O diagrama de arquitetura completo está em `docs/diagrams/software-arch.mermaid`.

## 🚀 Instalação

### Backend (NestJS)

```bash
cd nestjs-project
docker compose up -d
docker compose exec nestjs-api bash
npm install
npm run start:dev
```

A API estará disponível em `http://localhost:3000`.

### Executar testes

```bash
# Testes unitários
npm run test

# Testes e2e
npm run test:e2e

# Cobertura de testes
npm run test:cov
```

## 🛠️ Estrutura do Projeto

```
green-field-ia-project/
├── docs/
│   ├── project-plan.md                  # Planejamento geral do projeto
│   └── diagrams/
│       └── software-arch.mermaid        # Diagrama de arquitetura (C4)
├── nestjs-project/                      # Backend API
│   ├── src/
│   │   ├── main.ts                      # Entry point
│   │   ├── app.module.ts                # Módulo raiz
│   │   ├── app.controller.ts            # Controller principal
│   │   └── app.service.ts               # Service principal
│   ├── test/                            # Testes e2e
│   ├── compose.yaml                     # Docker Compose (API + PostgreSQL)
│   └── Dockerfile.dev                   # Dockerfile de desenvolvimento
├── CLAUDE.md                            # Instruções para IA
├── whiteboard.png                       # Quadro branco do projeto
└── README.md
```

## 📚 Fases do Projeto

| Fase | Descrição | Dependência |
|------|-----------|-------------|
| **01** | Configuração Base do Projeto | — |
| **02** | Cadastro, Login e Gerenciamento de Conta | Fase 01 |
| **03** | Upload e Processamento de Vídeos | Fase 01, 02 |
| **04** | Gerenciamento de Vídeos e Canal | Fase 02, 03 |
| **05** | Página de Visualização do Vídeo | Fase 03, 04 |
| **06** | Interações Sociais (Likes, Comentários, Inscrições) | Fase 02, 05 |
| **07** | Página Inicial, Busca e Finalização | Todas |

Detalhes completos em `docs/project-plan.md`.

## 📖 Stack Tecnológica

| Camada | Tecnologia |
|--------|------------|
| Frontend | Next.js |
| Backend | NestJS 11, TypeScript, Express |
| Banco de Dados | PostgreSQL 17 |
| Containerização | Docker, Docker Compose |
| Testes | Jest, Supertest |
| Linting | ESLint, Prettier |
