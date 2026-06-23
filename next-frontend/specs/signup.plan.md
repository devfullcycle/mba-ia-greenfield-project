---
subproject: frontend
runner: playwright
scope: phase-02-auth-frontend
si: SI-02.10b
target_file: tests/auth-signup.e2e-spec.ts
---

# Tela de cadastro — Test Plan

## Application Overview

A tela `/signup` permite o cadastro de um novo usuário com e-mail e senha. É uma rota anônima (sem guard de sessão): um shell RSC compõe o form `"use client"` (`components/auth/signup-form.tsx`, react-hook-form + Zod), que submete via `fetch("/api/auth/signup")` ao Route Handler BFF, que proxia `POST /auth/register` no NestJS upstream. Em `201` a conta é criada (não confirmada — o backend dispara um e-mail de confirmação) e nenhuma sessão é estabelecida nesta etapa. Erros `409` (e-mail já registrado) e `400` (validação) são mapeados para feedback inline; a validação client-side espelha o backend 1:1 e bloqueia o submit antes de chamar a rede.

## Test Scenarios

### 1. Cadastrar novo usuário com e-mail e senha

**Setup:** `next-frontend/tests/fixtures.ts` (MSW network fixture auto-applied; server-side upstream faked via `instrumentation.ts`, no browser `page.route()` of `/api/**`)

#### 1.1. signup-sucesso-conta-criada

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-05-16T21:32:09Z

**Steps:**
  1. Usuário navega para `/signup`
    - expect: o `Card` de cadastro renderiza com os campos de e-mail e senha e o botão de submit
  2. Usuário preenche e-mail e senha válidos, marca o checkbox de termos e clica em "Sign up"
    - expect: a requisição `POST /api/auth/signup` é disparada com payload tipado (e-mail/senha)
    - expect: enquanto a mutation está em voo, o `SubmitButton` fica desabilitado / em estado de loading
  3. Backend responde `201`
    - expect: o estado de sucesso de conta criada é exibido (mensagem indicando que a conta foi criada e o e-mail de confirmação enviado)
    - expect: nenhuma sessão é estabelecida — não há cookie de sessão nem redirect para área autenticada

#### 1.2. signup-erro-409-email-ja-registrado

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-05-16T21:32:09Z

**Steps:**
  1. Usuário navega para `/signup` e submete o form com um e-mail que já existe (reserved trigger upstream → `409`, e.g. `conflict@example.com`)
    - expect: `POST /api/auth/signup` retorna `409`
    - expect: um hint inline aparece no campo de e-mail informando que o e-mail já está registrado
    - expect: o hint inclui um CTA "fazer login" que navega client-side para `/login`
  2. Usuário corrige o e-mail para um inédito e submete novamente, recebendo `400` (reserved trigger → validação, e.g. `badrequest@example.com`)
    - expect: a mensagem `400` é renderizada inline abaixo do campo ofensor (não como erro global de campo de e-mail)

#### 1.3. signup-validacao-client-side-bloqueia-submit

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-05-16T21:32:09Z

**Steps:**
  1. Usuário navega para `/signup` e clica em "Sign up" com o form vazio
    - expect: nenhuma requisição `POST /api/auth/signup` é disparada (submit bloqueado pela validação client-side)
    - expect: mensagens de validação inline aparecem nos campos obrigatórios
  2. Usuário preenche dados que violam as regras espelhadas do backend (e.g. e-mail malformado, senha fraca) e/ou deixa o checkbox de termos desmarcado
    - expect: o submit permanece bloqueado e as mensagens inline refletem as mesmas regras do backend (sem divergência client/server)
  3. Usuário corrige todos os campos para valores válidos e marca os termos
    - expect: o submit é liberado e `POST /api/auth/signup` é disparada
