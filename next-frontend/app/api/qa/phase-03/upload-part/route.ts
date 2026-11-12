import { env } from "@/lib/env";
import {
  MAX_PART_BYTES,
  authorizationFor,
  isAllowedStorageUrl,
  isQaEnabled,
  notFound,
  parseProfile,
  putToPresignedUrl,
  qaError,
} from "@/lib/qa/phase-03/server";

/**
 * Receives the file from the browser and PUTs it to the presigned storage URL server-side
 * (the browser cannot reach MinIO). Returns `{ status, etag }` with the ETag unquoted.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isQaEnabled()) return notFound();

  const profile = parseProfile(request.headers.get("x-qa-profile"));
  if (!profile || profile === "anonymous" || authorizationFor(profile) === undefined) {
    return qaError(401, "QA_PROFILE_REQUIRED", "Selecione um perfil autenticado com token configurado.");
  }

  const target = isAllowedStorageUrl(request.headers.get("x-qa-part-url") ?? "");
  if (!target) return qaError(400, "QA_STORAGE_URL_NOT_ALLOWED", "URL de armazenamento não permitida.");

  const body = Buffer.from(await request.arrayBuffer());
  if (body.length === 0) return qaError(400, "QA_EMPTY_BODY", "Arquivo vazio.");
  if (body.length > MAX_PART_BYTES) {
    return qaError(413, "QA_PART_TOO_LARGE", "Esta página cobre apenas uploads de uma parte (até 5 MiB).");
  }

  try {
    const result = await putToPresignedUrl(
      target,
      body,
      request.headers.get("content-type") ?? "application/octet-stream",
      env.QA_STORAGE_CONNECT,
    );
    return Response.json({ status: result.status, etag: result.etag }, { status: result.status === 200 ? 200 : 502 });
  } catch (e) {
    return qaError(502, "QA_STORAGE_UNREACHABLE", `Falha ao enviar ao armazenamento: ${e instanceof Error ? e.message : String(e)}`);
  }
}
