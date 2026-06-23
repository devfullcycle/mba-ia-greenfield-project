import { http, HttpResponse } from "msw";

import type {
  RegisterResponse,
  LoginTokenPair,
  RefreshTokenPair,
  ApiErrorEnvelope,
} from "@/lib/api/contracts";
import { env } from "@/lib/env";

// Reserved trigger table (shared with E2E — trigger values must not collide across test suites).
const CONFLICT_EMAIL = "conflict@example.com";
const BAD_REQUEST_EMAIL = "badrequest@example.com";
const INVALID_CREDENTIALS_EMAIL = "invalid@example.com";
const UNCONFIRMED_EMAIL = "unconfirmed@example.com";

function errorEnvelope(
  statusCode: number,
  error: string,
  message: string
): ApiErrorEnvelope {
  return { statusCode, error, message, code: null };
}

export const handlers = [
  // POST /auth/register
  http.post(`${env.API_URL}/auth/register`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const email = typeof body.email === "string" ? body.email : "";

    if (email === CONFLICT_EMAIL) {
      return HttpResponse.json(
        errorEnvelope(409, "EMAIL_ALREADY_REGISTERED", "Email already registered"),
        { status: 409 }
      );
    }
    if (email === BAD_REQUEST_EMAIL) {
      return HttpResponse.json(
        errorEnvelope(400, "VALIDATION_FAILED", "Validation failed"),
        { status: 400 }
      );
    }
    return HttpResponse.json<RegisterResponse>(
      { id: "user-fixture-id", email },
      { status: 201 }
    );
  }),

  // POST /auth/login
  http.post(`${env.API_URL}/auth/login`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const email = typeof body.email === "string" ? body.email : "";

    if (email === BAD_REQUEST_EMAIL) {
      return HttpResponse.json(
        errorEnvelope(400, "VALIDATION_FAILED", "Validation failed"),
        { status: 400 }
      );
    }
    if (email === INVALID_CREDENTIALS_EMAIL) {
      return HttpResponse.json(
        errorEnvelope(401, "INVALID_CREDENTIALS", "Invalid email or password"),
        { status: 401 }
      );
    }
    if (email === UNCONFIRMED_EMAIL) {
      return HttpResponse.json(
        errorEnvelope(403, "EMAIL_NOT_CONFIRMED", "Email not confirmed"),
        { status: 403 }
      );
    }
    return HttpResponse.json<LoginTokenPair>(
      { access_token: "fixture-access-token", refresh_token: "fixture-refresh-token" },
      { status: 200 }
    );
  }),

  // POST /auth/logout
  http.post(`${env.API_URL}/auth/logout`, () => {
    return new HttpResponse(null, { status: 204 });
  }),

  // POST /auth/forgot-password
  http.post(`${env.API_URL}/auth/forgot-password`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const email = typeof body.email === "string" ? body.email : "";

    if (email === BAD_REQUEST_EMAIL) {
      return HttpResponse.json(
        errorEnvelope(400, "VALIDATION_FAILED", "Validation failed"),
        { status: 400 }
      );
    }
    return new HttpResponse(null, { status: 204 });
  }),

  // POST /auth/refresh
  http.post(`${env.API_URL}/auth/refresh`, () => {
    return HttpResponse.json<RefreshTokenPair>(
      { access_token: "new-fixture-access-token", refresh_token: "new-fixture-refresh-token" },
      { status: 200 }
    );
  }),
];
