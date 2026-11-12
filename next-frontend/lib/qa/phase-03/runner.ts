import { SECTIONS, STEPS, stepsOf } from "./steps";
import type {
  Check,
  CheckResult,
  Ctx,
  Profile,
  StepDef,
  StepResponse,
  StepResult,
} from "./types";
import { PROFILE_LABEL } from "./types";

export const QA_API_BASE = "/api/qa/phase-03/api";
export const QA_UPLOAD_PART_URL = "/api/qa/phase-03/upload-part";

export interface RunnerDeps {
  fetchImpl: typeof fetch;
  /** Returns the file chosen by the QA (or the sample), if any. */
  getFile: () => Blob | undefined;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  pollTimeoutMs?: number;
  pollIntervalMs?: number;
  /** Called on each poll with the observed video status. */
  onPoll?: (status: string, elapsedMs: number) => void;
}

export function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc === null || acc === undefined) return undefined;
    return (acc as Record<string, unknown>)[key];
  }, obj);
}

export function describeCheck(c: Check): string {
  switch (c.type) {
    case "status":
      return `HTTP ${c.expected}`;
    case "header":
      return `${c.label ?? c.name}: ${c.equals ?? String(c.matches)}`;
    case "json":
      return `${c.label ?? c.path} = ${String(c.equals)}`;
    case "jsonPresent":
      return `${c.label ?? c.path} presente`;
    case "errorCode":
      return `código de erro ${c.code}`;
  }
}

export function evaluateChecks(checks: Check[], res: StepResponse): CheckResult[] {
  return checks.map((c): CheckResult => {
    const label = describeCheck(c);
    switch (c.type) {
      case "status":
        return { label, expected: String(c.expected), received: String(res.status), ok: res.status === c.expected };
      case "header": {
        const v = res.headers[c.name.toLowerCase()];
        const ok = v !== undefined && (c.equals !== undefined ? v === c.equals : (c.matches?.test(v) ?? false));
        return { label, expected: c.equals ?? String(c.matches), received: v ?? "(ausente)", ok };
      }
      case "json": {
        const v = getPath(res.json, c.path);
        return { label, expected: String(c.equals), received: v === undefined ? "(ausente)" : String(v), ok: v === c.equals };
      }
      case "jsonPresent": {
        const v = getPath(res.json, c.path);
        const ok = v !== undefined && v !== null && v !== "";
        return { label, expected: "presente", received: ok ? "presente" : "(ausente)", ok };
      }
      case "errorCode": {
        // The API answers either { error: { code } } or { statusCode, error: "CODE" }.
        const raw = getPath(res.json, "error");
        const v = typeof raw === "string" ? raw : getPath(res.json, "error.code");
        return { label, expected: c.code, received: v === undefined ? "(ausente)" : String(v), ok: v === c.code };
      }
    }
  });
}

async function toStepResponse(res: Response): Promise<StepResponse> {
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    headers[k.toLowerCase()] = v;
  });
  const type = headers["content-type"] ?? "";
  if (type.includes("json")) {
    const text = await res.text();
    try {
      return { status: res.status, headers, json: JSON.parse(text), text: text.slice(0, 2000) };
    } catch {
      return { status: res.status, headers, text: text.slice(0, 2000) };
    }
  }
  // Media bodies are not downloaded: the verification only needs status and headers.
  await res.body?.cancel().catch(() => undefined);
  return { status: res.status, headers };
}

function profileHeaders(profile: Profile, extra?: Record<string, string>): Record<string, string> {
  return { "x-qa-profile": profile, ...extra };
}

interface CallOutcome {
  response: StepResponse;
  request: NonNullable<StepResult["request"]>;
}

async function callApi(step: StepDef, ctx: Ctx, deps: RunnerDeps): Promise<CallOutcome> {
  const spec = step.build(ctx);
  const url = `${QA_API_BASE}${spec.path}`;
  const headers = profileHeaders(step.profile, {
    ...(spec.body !== undefined ? { "content-type": "application/json" } : {}),
    ...spec.headers,
  });
  const res = await deps.fetchImpl(url, {
    method: spec.method,
    headers,
    body: spec.body !== undefined ? JSON.stringify(spec.body) : undefined,
    cache: "no-store",
  });
  return { response: await toStepResponse(res), request: { method: spec.method, url, profile: step.profile, headers: spec.headers, body: spec.body } };
}

async function callUpload(step: StepDef, ctx: Ctx, deps: RunnerDeps): Promise<CallOutcome> {
  const file = deps.getFile();
  if (!file) throw new BlockedError("Escolha um arquivo de vídeo (ou use o vídeo de exemplo) antes de executar este passo.");
  if (ctx.partSize && file.size > ctx.partSize) {
    throw new BlockedError(
      `O arquivo tem ${file.size} bytes e a parte tem no máximo ${ctx.partSize}. Esta página cobre apenas uploads de uma parte; use um arquivo menor.`,
    );
  }
  const res = await deps.fetchImpl(QA_UPLOAD_PART_URL, {
    method: "POST",
    headers: profileHeaders(step.profile, {
      "content-type": file.type || "video/mp4",
      "x-qa-part-url": ctx.partUrl ?? "",
    }),
    body: file,
  });
  return {
    response: await toStepResponse(res),
    request: { method: "PUT", url: "(URL pré-assinada, enviada pelo servidor)", profile: step.profile, body: `${file.size} bytes` },
  };
}

class BlockedError extends Error {}

export function missingNeeds(step: StepDef, ctx: Ctx): string | undefined {
  const missing = (step.needs ?? []).filter((k) => !ctx[k]);
  if (missing.length === 0) return undefined;
  return `Falta o estado de passos anteriores (${missing.join(", ")}). Execute antes o passo que o cria (ex.: U1/U2/U4 ou A1).`;
}

export interface ExecuteOutcome {
  result: StepResult;
  ctxPatch: Partial<Ctx>;
}

export async function executeStep(step: StepDef, ctx: Ctx, deps: RunnerDeps): Promise<ExecuteOutcome> {
  const now = deps.now ?? Date.now;
  const started = now();
  const at = new Date().toISOString();
  const base = { stepId: step.id, at, checks: [] as CheckResult[] };

  const blocked = missingNeeds(step, ctx);
  if (blocked) return { result: { ...base, status: "blocked", message: blocked, durationMs: 0 }, ctxPatch: {} };

  try {
    let trail: string[] | undefined;
    let out: CallOutcome;
    if (step.kind === "upload") {
      out = await callUpload(step, ctx, deps);
    } else if (step.kind === "poll") {
      const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
      const timeout = deps.pollTimeoutMs ?? 60_000;
      const interval = deps.pollIntervalMs ?? 2_000;
      trail = [];
      for (;;) {
        out = await callApi(step, ctx, deps);
        const st = getPath(out.response.json, "status");
        if (typeof st === "string") {
          if (trail[trail.length - 1] !== st) trail.push(st);
          deps.onPoll?.(st, now() - started);
        }
        if (st === "READY" || st === "ERROR" || out.response.status !== 200 || now() - started >= timeout) break;
        await sleep(interval);
      }
    } else {
      out = await callApi(step, ctx, deps);
    }

    const checks = evaluateChecks(step.checks, out.response);
    const ok = checks.every((c) => c.ok);
    const message =
      step.kind === "poll" && !ok && trail && trail[trail.length - 1] === "PROCESSING"
        ? "Tempo esgotado (60 s) com o vídeo ainda em PROCESSING. Verifique Redis, MinIO e o worker (docker compose logs video-worker)."
        : undefined;
    return {
      result: {
        ...base,
        status: ok ? "pass" : "fail",
        message,
        httpStatus: out.response.status,
        headers: out.response.headers,
        bodyPreview: out.response.text,
        durationMs: now() - started,
        checks,
        request: out.request,
        videoStatusTrail: trail,
      },
      ctxPatch: step.after?.(out.response, ctx) ?? {},
    };
  } catch (e) {
    const isBlocked = e instanceof BlockedError;
    return {
      result: {
        ...base,
        status: isBlocked ? "blocked" : "error",
        message: isBlocked ? e.message : `Falha de rede ao executar o passo: ${e instanceof Error ? e.message : String(e)}`,
        durationMs: now() - started,
      },
      ctxPatch: {},
    };
  }
}

export function applyPatch(ctx: Ctx, patch: Partial<Ctx>, stepId: string): Ctx {
  const next: Ctx = { ...ctx, ...patch };
  const created = stepId === "U1" ? patch.videoId : undefined;
  if (created) next.sessionVideoIds = [...new Set([...(ctx.sessionVideoIds ?? []), created])];
  return next;
}

/** Whether "run section/all" must stop after this result. */
export function shouldStop(step: StepDef, result: StepResult): boolean {
  if (result.status === "blocked" || result.status === "error") return true;
  return result.status === "fail" && !!step.critical;
}

export function summarize(results: Record<string, StepResult>, steps: StepDef[] = STEPS) {
  const total = steps.length;
  const executed = steps.filter((s) => results[s.id]).length;
  const passed = steps.filter((s) => results[s.id]?.status === "pass").length;
  const failed = steps.filter((s) => {
    const st = results[s.id]?.status;
    return st === "fail" || st === "error" || st === "blocked";
  });
  return { total, executed, passed, failed };
}

export function buildReport(results: Record<string, StepResult>, ctx: Ctx, generatedAt = new Date()): string {
  const { total, executed, passed, failed } = summarize(results);
  const lines: string[] = [
    "# Relatório QA — Fase 03 (API de vídeos)",
    "",
    `- Gerado em: ${generatedAt.toISOString()}`,
    `- Resultado: ${passed} de ${total} passos passaram (${executed} executados)`,
    `- videoId do upload: ${ctx.videoId ?? "(nenhum)"}`,
    `- abortVideoId: ${ctx.abortVideoId ?? "(nenhum)"}`,
    "",
  ];
  for (const section of SECTIONS) {
    lines.push(`## ${section.title}`, "", "| Passo | Perfil | HTTP | Resultado | Observação |", "| --- | --- | --- | --- | --- |");
    for (const step of stepsOf(section.id)) {
      const r = results[step.id];
      const label = !r ? "não executado" : r.status === "pass" ? "passou" : r.status === "fail" ? "FALHOU" : r.status === "blocked" ? "BLOQUEADO" : "ERRO";
      const notes = !r
        ? ""
        : [
            ...r.checks.filter((c) => !c.ok).map((c) => `${c.label}: esperado ${c.expected}, recebido ${c.received}`),
            r.message ?? "",
            r.videoStatusTrail ? `status observados: ${r.videoStatusTrail.join(" → ")}` : "",
          ]
            .filter(Boolean)
            .join("; ")
            .replace(/\|/g, "\\|");
      lines.push(`| ${step.id} | ${PROFILE_LABEL[step.profile]} | ${r?.httpStatus ?? "-"} | ${label} | ${notes} |`);
    }
    lines.push("");
  }
  if (failed.length) {
    lines.push("## Falhas", "", ...failed.map((s) => `- ${s.id} — ${s.title}`), "");
  }
  return lines.join("\n");
}
