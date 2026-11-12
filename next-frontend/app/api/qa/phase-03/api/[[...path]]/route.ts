import { env } from "@/lib/env";
import {
  FORWARDED_RESPONSE_HEADERS,
  authorizationFor,
  isAllowedRoute,
  isQaEnabled,
  notFound,
  parseProfile,
  qaError,
} from "@/lib/qa/phase-03/server";

type Ctx = { params: Promise<{ path?: string[] }> };

async function handle(request: Request, { params }: Ctx): Promise<Response> {
  if (!isQaEnabled()) return notFound();

  const { path = [] } = await params;
  const upstreamPath = path.length === 0 ? "/" : `/${path.join("/")}`;
  const method = request.method;
  if (!isAllowedRoute(method, upstreamPath)) {
    return qaError(404, "QA_ROUTE_NOT_ALLOWED", "Rota fora da lista permitida para o QA da Fase 03.");
  }

  const url = new URL(request.url);
  // Header for fetch() calls, query string for <video>/<img>/<a> which cannot set headers.
  const profile = parseProfile(request.headers.get("x-qa-profile") ?? url.searchParams.get("profile")) ?? "anonymous";
  const authorization = authorizationFor(profile);
  if (authorization === undefined) {
    return qaError(503, "QA_TOKEN_MISSING", `Token do perfil "${profile}" não configurado no servidor (QA_OWNER_TOKEN / QA_OTHER_TOKEN).`);
  }

  const headers = new Headers();
  if (authorization) headers.set("authorization", authorization);
  const range = request.headers.get("range");
  if (range) headers.set("range", range);
  const hasBody = method === "POST";
  if (hasBody) headers.set("content-type", "application/json");

  let upstream: Response;
  try {
    upstream = await fetch(`${env.API_URL}${upstreamPath}`, {
      method,
      headers,
      body: hasBody ? await request.text() : undefined,
      cache: "no-store",
    });
  } catch {
    return qaError(502, "QA_UPSTREAM_UNREACHABLE", "A API não respondeu. Ela está no ar?");
  }

  const out = new Headers();
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) out.set(name, value);
  }
  return new Response(upstream.status === 204 ? null : upstream.body, { status: upstream.status, headers: out });
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
