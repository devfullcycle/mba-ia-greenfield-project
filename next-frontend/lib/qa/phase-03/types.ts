export type Profile = "owner" | "other" | "anonymous" | "invalid";

export const PROFILE_LABEL: Record<Profile, string> = {
  owner: "Dono do vídeo",
  other: "Outro usuário",
  anonymous: "Anônimo (sem login)",
  invalid: "Token inválido",
};

export type SectionId = "preflight" | "read" | "media" | "upload" | "abort" | "errors";

export interface Ctx {
  videoId?: string;
  abortVideoId?: string;
  partUrl?: string;
  etag?: string;
  partSize?: number;
  /** Ids of videos created during this QA session (shown in the gallery). */
  sessionVideoIds?: string[];
}

export type CtxKey = keyof Omit<Ctx, "sessionVideoIds" | "partSize">;

export type Check =
  | { type: "status"; expected: number }
  | { type: "header"; name: string; equals?: string; matches?: RegExp; label?: string }
  | { type: "json"; path: string; equals: string | number | boolean; label?: string }
  | { type: "jsonPresent"; path: string; label?: string }
  | { type: "errorCode"; code: string };

export interface RequestSpec {
  method: "GET" | "POST" | "DELETE";
  /** Upstream path, e.g. /videos/abc/stream */
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface StepDef {
  id: string;
  section: SectionId;
  title: string;
  /** What this verification proves, in QA language. */
  proves: string;
  profile: Profile;
  /** Human-readable "METHOD route" shown on the card. */
  route: string;
  kind?: "http" | "upload" | "poll";
  /** Context values that must exist before the step can run. */
  needs?: CtxKey[];
  /** Stops "run section" when this step fails. */
  critical?: boolean;
  /** For `kind: "poll"`: stop polling when the video reaches one of these. */
  build: (ctx: Ctx) => RequestSpec;
  checks: Check[];
  /** Extracts shared state from the response. */
  after?: (res: StepResponse, ctx: Ctx) => Partial<Ctx>;
}

export interface StepResponse {
  status: number;
  headers: Record<string, string>;
  /** Parsed JSON body when the response is JSON, otherwise undefined. */
  json?: unknown;
  /** Short raw preview for non-JSON bodies. */
  text?: string;
}

export interface CheckResult {
  label: string;
  expected: string;
  received: string;
  ok: boolean;
}

export type StepStatus = "pass" | "fail" | "blocked" | "error";

export interface StepResult {
  stepId: string;
  status: StepStatus;
  /** Why it was blocked / errored. */
  message?: string;
  httpStatus?: number;
  headers?: Record<string, string>;
  bodyPreview?: string;
  durationMs: number;
  checks: CheckResult[];
  request?: { method: string; url: string; profile: Profile; headers?: Record<string, string>; body?: unknown };
  videoStatusTrail?: string[];
  at: string;
}
