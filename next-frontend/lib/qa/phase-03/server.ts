import "server-only";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

import { env } from "@/lib/env";
import type { Profile } from "./types";

export const MAX_PART_BYTES = 5 * 1024 * 1024;

/** The QA tooling is dev-only: handlers and the page answer 404 in production. */
export function isQaEnabled(): boolean {
  return env.NODE_ENV !== "production";
}

export function notFound(): Response {
  return new Response(null, { status: 404 });
}

export function qaError(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

export function parseProfile(value: string | null): Profile | undefined {
  return value === "owner" || value === "other" || value === "anonymous" || value === "invalid" ? value : undefined;
}

/** Returns the Authorization header value for a profile; `null` = no header; `undefined` = token not configured. */
export function authorizationFor(profile: Profile): string | null | undefined {
  switch (profile) {
    case "anonymous":
      return null;
    case "invalid":
      return "Bearer token-invalido";
    case "owner":
      return env.QA_OWNER_TOKEN ? `Bearer ${env.QA_OWNER_TOKEN}` : undefined;
    case "other":
      return env.QA_OTHER_TOKEN ? `Bearer ${env.QA_OTHER_TOKEN}` : undefined;
  }
}

const ID = "[A-Za-z0-9_-]{1,32}";
const ALLOWED: { method: string; pattern: RegExp }[] = [
  { method: "GET", pattern: /^\/$/ },
  { method: "POST", pattern: /^\/videos\/uploads$/ },
  { method: "GET", pattern: new RegExp(`^/videos/${ID}$`) },
  { method: "GET", pattern: new RegExp(`^/videos/${ID}/(stream|download|thumbnail)$`) },
  { method: "POST", pattern: new RegExp(`^/videos/${ID}/uploads/(parts|complete)$`) },
  { method: "DELETE", pattern: new RegExp(`^/videos/${ID}/uploads$`) },
];

/** Whitelist of upstream routes used by the Phase 03 script. This is not an open proxy. */
export function isAllowedRoute(method: string, path: string): boolean {
  return ALLOWED.some((r) => r.method === method && r.pattern.test(path));
}

/** Response headers forwarded to the browser (everything else, e.g. cookies, is dropped). */
export const FORWARDED_RESPONSE_HEADERS = [
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
  "content-disposition",
  "etag",
  "cache-control",
] as const;

const ALLOWED_STORAGE_HOSTS = new Set(["localhost:9000", "127.0.0.1:9000", "minio:9000", "host.docker.internal:9000"]);

export function isAllowedStorageUrl(raw: string): URL | undefined {
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) return undefined;
    return ALLOWED_STORAGE_HOSTS.has(url.host) ? url : undefined;
  } catch {
    return undefined;
  }
}

export interface PutResult {
  status: number;
  etag?: string;
}

/**
 * PUTs a buffer to a presigned URL. SigV4 signatures are bound to the Host header,
 * and `fetch` cannot override Host, so we use node:http: the TCP connection goes to
 * `connect` ("host:port", e.g. host.docker.internal:9000) while Host keeps the signed URL's host.
 */
export function putToPresignedUrl(url: URL, body: Buffer, contentType: string, connect?: string): Promise<PutResult> {
  const [connectHost, connectPort] = connect?.split(":") ?? [];
  const isHttps = url.protocol === "https:";
  const send = isHttps ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = send(
      {
        method: "PUT",
        host: connectHost || url.hostname,
        port: Number(connectPort || url.port || (isHttps ? 443 : 80)),
        path: `${url.pathname}${url.search}`,
        headers: { Host: url.host, "Content-Length": body.length, "Content-Type": contentType },
        timeout: 30_000,
      },
      (res) => {
        res.resume();
        res.on("end", () => {
          const raw = res.headers.etag;
          resolve({ status: res.statusCode ?? 0, etag: raw?.replace(/"/g, "") });
        });
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("Tempo esgotado ao enviar a parte ao armazenamento")));
    req.on("error", reject);
    req.end(body);
  });
}
