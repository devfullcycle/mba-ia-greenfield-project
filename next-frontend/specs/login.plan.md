---
subproject: frontend
runner: playwright
scope: phase-02-auth-frontend
si: SI-02.11b
target_file: tests/auth-login.e2e-spec.ts
---

# Tela de login — Test Plan

## Application Overview

A tela `/login` autentica um usuário com e-mail e senha e inicia a sessão. É uma rota anônima: um shell RSC compõe o form `"use client"` (`components/auth/login-form.tsx`, react-hook-form + Zod), que submete via `fetch("/api/auth/login")` ao Route Handler BFF, que proxia `POST /auth/login` no NestJS upstream. Em `200` o BFF sela o cookie `iron-session` encriptado (carregando `access_token`/`refresh_token` + fingerprint mínimo do usuário) — os tokens nunca chegam ao browser — e o form dispara `router.refresh()` para o chrome refletir o estado autenticado. Erros `401` (credenciais inválidas), `403` (e-mail não confirmado) e `400` (validação) são mapeados para alertas/feedback; a validação client-side espelha o backend 1:1.

## Test Scenarios

### 1. Autenticar usuário com e-mail e senha e iniciar sessão

**Setup:** `next-frontend/tests/fixtures.ts` (MSW network fixture auto-applied; server-side upstream faked via `instrumentation.ts`, no browser `page.route()` of `/api/**`)

#### 1.1. login-sucesso-sessao-iniciada

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-05-16T21:32:09Z

**Steps:**
  1. Usuário navega para `/login`
    - expect: o `Card` de login renderiza com campos de e-mail e senha e o botão "Sign in"
  2. Usuário preenche credenciais válidas e clica em "Sign in"
    - expect: a requisição `POST /api/auth/login` é disparada com payload tipado
    - expect: enquanto a mutation está em voo, o `SubmitButton` fica desabilitado / em loading
  3. Backend responde `200` e o BFF sela o cookie de sessão
    - expect: nenhum `access_token`/`refresh_token` aparece no corpo da resposta visível ao client nem em storage do browser
    - expect: a UI reflete o estado autenticado (chrome atualizado via `router.refresh()`) / redireciona para a área autenticada

#### 1.2. login-erros-401-403-400

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-05-16T21:32:09Z

**Steps:**
  1. Usuário submete o form com credenciais inválidas (reserved trigger upstream → `401`)
    - expect: um `Alert` form-level de "credenciais inválidas" é renderizado
    - expect: nenhuma sessão é estabelecida
  2. Usuário submete com um e-mail cuja conta não foi confirmada (reserved trigger → `403`)
    - expect: um `Alert` form-level de "e-mail não confirmado" é renderizado, com CTA de reenvio de confirmação
  3. Usuário submete com payload que dispara validação upstream (reserved trigger → `400`)
    - expect: a mensagem `400` é renderizada inline abaixo do campo ofensor

#### 1.3. login-validacao-client-side-bloqueia-submit

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-05-16T21:32:09Z

**Steps:**
  1. Usuário navega para `/login` e clica em "Sign in" com o form vazio
    - expect: nenhuma requisição `POST /api/auth/login` é disparada (submit bloqueado client-side)
    - expect: mensagens de validação inline aparecem nos campos obrigatórios
  2. Usuário preenche valores que violam as regras espelhadas do backend (e.g. e-mail malformado)
    - expect: o submit permanece bloqueado e as mensagens inline espelham o backend 1:1
  3. Usuário corrige os campos para valores válidos
    - expect: o submit é liberado e `POST /api/auth/login` é disparada
