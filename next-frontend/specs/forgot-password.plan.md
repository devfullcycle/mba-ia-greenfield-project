---
subproject: frontend
runner: playwright
scope: phase-02-auth-frontend
si: SI-02.12b
target_file: tests/auth-forgot-password.e2e-spec.ts
---

# Tela de solicitação de recuperação de senha — Test Plan

## Application Overview

A tela `/forgot-password` cobre a etapa de solicitação do fluxo de recuperação de senha: o usuário informa o e-mail e o backend envia um link de redefinição. É uma rota anônima: um shell RSC compõe o form `"use client"` (`components/auth/forgot-password-form.tsx`, react-hook-form + Zod), que submete via `fetch("/api/auth/forgot-password")` ao Route Handler BFF, que proxia `POST /auth/forgot-password` no NestJS upstream. O upstream responde `204` independentemente de o e-mail estar registrado (anti-enumeration); a FE renderiza um estado de sucesso inline no mesmo `Card` (form substituído), sem rota dedicada. Erro `400` (validação) é mapeado para feedback inline abaixo do campo de e-mail; a validação client-side espelha o backend 1:1.

## Test Scenarios

### 1. Solicitar envio de e-mail com link de redefinição de senha

**Setup:** `next-frontend/tests/fixtures.ts` (MSW network fixture auto-applied; server-side upstream faked via `instrumentation.ts`, no browser `page.route()` of `/api/**`)

#### 1.1. forgot-password-sucesso-inline

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-05-16T21:32:09Z

**Steps:**
  1. Usuário navega para `/forgot-password`
    - expect: o `Card` renderiza com o campo de e-mail e o botão "Send reset link"
  2. Usuário preenche um e-mail válido (registrado) e clica em "Send reset link"
    - expect: a requisição `POST /api/auth/forgot-password` é disparada com payload tipado
    - expect: enquanto a mutation está em voo, o `SubmitButton` fica desabilitado / em loading
  3. Backend responde `204`
    - expect: a caixa de confirmação inline substitui o form dentro do mesmo `Card`
    - expect: nenhuma sessão é estabelecida e não há navegação para outra rota

#### 1.2. forgot-password-anti-enumeration

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-05-16T21:32:09Z

**Steps:**
  1. Usuário navega para `/forgot-password` e submete um e-mail não registrado (válido em formato)
    - expect: `POST /api/auth/forgot-password` retorna `204` (anti-enumeration upstream — no-op)
    - expect: a mesma caixa de confirmação inline do cenário 1.1 é renderizada, sem qualquer texto que revele se a conta existe ou não

#### 1.3. forgot-password-erro-400-e-validacao-client-side

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-05-16T21:32:09Z

**Steps:**
  1. Usuário navega para `/forgot-password` e clica em "Send reset link" com o campo de e-mail vazio
    - expect: nenhuma requisição `POST /api/auth/forgot-password` é disparada (submit bloqueado client-side)
    - expect: uma mensagem de validação inline aparece abaixo do campo de e-mail
  2. Usuário informa um e-mail malformado
    - expect: o submit permanece bloqueado e a mensagem inline espelha a regra do backend 1:1
  3. Usuário informa um e-mail bem-formado que dispara validação upstream (reserved trigger → `400`) e submete
    - expect: a mensagem `400` é renderizada inline abaixo do campo de e-mail (form não substituído)
