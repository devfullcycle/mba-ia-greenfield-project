import type { Check, Ctx, SectionId, StepDef } from "./types";

export const SEED = {
  ready: "ThlVOZkDUF",
  processing: "mO46RhTA92",
  error: "jgINrSoIxv",
  otherProcessing: "W8kCDreTVS",
  missing: "naoexiste0",
} as const;

export const SAMPLE_SIZE_BYTES = 905702;
const SAMPLE_META = { filename: "sample.mp4", mime: "video/mp4", size: SAMPLE_SIZE_BYTES };

export const SECTIONS: { id: SectionId; title: string; intro: string }[] = [
  {
    id: "preflight",
    title: "Preflight",
    intro: "Confirma que a API está no ar, que a massa de dados (seed) existe e que o token de teste é aceito.",
  },
  {
    id: "read",
    title: "Leitura e visibilidade (L1–L8)",
    intro:
      "Quem pode ver os dados de cada vídeo? Só vídeos prontos (READY) são públicos; o dono vê qualquer status; os demais recebem 404.",
  },
  {
    id: "media",
    title: "Entrega de mídia (M1–M11)",
    intro: "Stream, download e thumbnail, incluindo requisições parciais (Range) e os casos em que a mídia não deve existir.",
  },
  {
    id: "upload",
    title: "Upload e processamento (U1–U6)",
    intro:
      "Fluxo completo: iniciar, enviar a parte, finalizar e acompanhar DRAFT → PROCESSING → READY. Execute em ordem; os passos compartilham o vídeo criado.",
  },
  {
    id: "abort",
    title: "Abortar rascunho (A1–A3)",
    intro: "Cria um rascunho e o cancela. Cancelar de novo deve falhar com 404.",
  },
  {
    id: "errors",
    title: "Validação de entrada e autenticação (E1–E5)",
    intro: "Entradas inválidas e acesso sem token devem ser rejeitados com o código correto.",
  },
];

const status = (expected: number): Check => ({ type: "status", expected });
const code = (c: string): Check => ({ type: "errorCode", code: c });
const hdr = (name: string, equals: string): Check => ({ type: "header", name, equals });
const vid = (ctx: Ctx) => ctx.videoId ?? "";
const READY_META: Check[] = [
  { type: "json", path: "duration_seconds", equals: 6, label: "duração (s)" },
  { type: "json", path: "width", equals: 640, label: "largura" },
  { type: "json", path: "height", equals: 360, label: "altura" },
  { type: "json", path: "codec", equals: "h264", label: "codec" },
];

const get = (path: string, headers?: Record<string, string>) => () => ({ method: "GET" as const, path, headers });
const rangeGet = (path: string, range: string) => get(path, { Range: range });

export const STEPS: StepDef[] = [
  // ── Preflight ──────────────────────────────────────────────────────────────
  {
    id: "P1", section: "preflight", title: "API no ar", profile: "anonymous", route: "GET /",
    proves: "A API responde. Se falhar, suba o ambiente (docker compose up -d) e a API em :3000.",
    build: get("/"), checks: [status(200)],
  },
  {
    id: "P2", section: "preflight", title: "Seed e token do dono", profile: "owner", route: `GET /videos/${SEED.ready}`,
    proves: "A seed existe e o token do dono funciona sem login. 404 = falta rodar a seed; 401 = gere os tokens de novo.",
    build: get(`/videos/${SEED.ready}`), checks: [status(200)],
  },
  {
    id: "P3", section: "preflight", title: "Token aceito em rota autenticada", profile: "owner",
    route: `POST /videos/${SEED.missing}/uploads/parts`,
    proves: "O token é aceito (nunca 401); o vídeo não existe, então a resposta correta é 404.",
    build: () => ({ method: "POST", path: `/videos/${SEED.missing}/uploads/parts`, body: { part_numbers: [1] } }),
    checks: [status(404)],
  },

  // ── Leitura e visibilidade ─────────────────────────────────────────────────
  {
    id: "L1", section: "read", title: "Metadados READY, anônimo", profile: "anonymous", route: `GET /videos/${SEED.ready}`,
    proves: "Qualquer pessoa vê os metadados de um vídeo pronto, com duração, dimensões, codec e URLs de mídia.",
    build: get(`/videos/${SEED.ready}`),
    checks: [
      status(200),
      { type: "json", path: "status", equals: "READY", label: "status" },
      ...READY_META,
      { type: "jsonPresent", path: "stream_url" },
      { type: "jsonPresent", path: "download_url" },
      { type: "jsonPresent", path: "thumbnail_url" },
    ],
  },
  {
    id: "L2", section: "read", title: "Metadados READY, dono", profile: "owner", route: `GET /videos/${SEED.ready}`,
    proves: "O dono também enxerga o vídeo pronto.", build: get(`/videos/${SEED.ready}`), checks: [status(200)],
  },
  {
    id: "L3", section: "read", title: "Metadados PROCESSING, anônimo", profile: "anonymous", route: `GET /videos/${SEED.processing}`,
    proves: "Vídeo em processamento não é público: anônimo recebe 404.",
    build: get(`/videos/${SEED.processing}`), checks: [status(404), code("VIDEO_NOT_FOUND")],
  },
  {
    id: "L4", section: "read", title: "Metadados PROCESSING, dono", profile: "owner", route: `GET /videos/${SEED.processing}`,
    proves: "O dono acompanha seu vídeo em processamento.",
    build: get(`/videos/${SEED.processing}`),
    checks: [status(200), { type: "json", path: "status", equals: "PROCESSING", label: "status" }],
  },
  {
    id: "L5", section: "read", title: "Metadados ERROR, dono", profile: "owner", route: `GET /videos/${SEED.error}`,
    proves: "O dono vê que o processamento falhou e o motivo.",
    build: get(`/videos/${SEED.error}`),
    checks: [
      status(200),
      { type: "json", path: "status", equals: "ERROR", label: "status" },
      { type: "json", path: "error_reason", equals: "PROBE_FAILED", label: "error_reason" },
    ],
  },
  {
    id: "L6", section: "read", title: "Vídeo de outro usuário, pedido pelo dono", profile: "owner", route: `GET /videos/${SEED.otherProcessing}`,
    proves: "Não vaza a existência do vídeo alheio: 404.", build: get(`/videos/${SEED.otherProcessing}`), checks: [status(404)],
  },
  {
    id: "L7", section: "read", title: "Token inválido vale como anônimo", profile: "invalid", route: `GET /videos/${SEED.ready}`,
    proves: "Um token inválido não derruba a leitura pública (200 em vídeo READY).",
    build: get(`/videos/${SEED.ready}`), checks: [status(200)],
  },
  {
    id: "L8", section: "read", title: "Id inexistente", profile: "anonymous", route: `GET /videos/${SEED.missing}`,
    proves: "Id desconhecido responde 404 VIDEO_NOT_FOUND.", build: get(`/videos/${SEED.missing}`),
    checks: [status(404), code("VIDEO_NOT_FOUND")],
  },

  // ── Mídia ──────────────────────────────────────────────────────────────────
  {
    id: "M1", section: "media", title: "Stream completo", profile: "anonymous", route: `GET /videos/${SEED.ready}/stream`,
    proves: "O arquivo é entregue inteiro e o servidor declara suporte a Range.",
    build: get(`/videos/${SEED.ready}/stream`),
    checks: [status(200), hdr("accept-ranges", "bytes"), hdr("content-length", String(SAMPLE_SIZE_BYTES))],
  },
  {
    id: "M2", section: "media", title: "Stream com Range 0-1023", profile: "anonymous", route: `GET /videos/${SEED.ready}/stream (Range: bytes=0-1023)`,
    proves: "Resposta parcial com o intervalo pedido (base do seek no player).",
    build: rangeGet(`/videos/${SEED.ready}/stream`, "bytes=0-1023"),
    checks: [status(206), hdr("content-range", `bytes 0-1023/${SAMPLE_SIZE_BYTES}`)],
  },
  {
    id: "M3", section: "media", title: "Stream com Range aberto", profile: "anonymous", route: `GET /videos/${SEED.ready}/stream (Range: bytes=900000-)`,
    proves: "Range sem fim vai até o último byte.", build: rangeGet(`/videos/${SEED.ready}/stream`, "bytes=900000-"),
    checks: [status(206)],
  },
  {
    id: "M4", section: "media", title: "Range fora do arquivo", profile: "anonymous", route: `GET /videos/${SEED.ready}/stream (Range: bytes=999999999-)`,
    proves: "Intervalo impossível é recusado com 416 e informa o tamanho real.",
    build: rangeGet(`/videos/${SEED.ready}/stream`, "bytes=999999999-"),
    checks: [status(416), hdr("content-range", `bytes */${SAMPLE_SIZE_BYTES}`), code("RANGE_NOT_SATISFIABLE")],
  },
  {
    id: "M5", section: "media", title: "Download", profile: "anonymous", route: `GET /videos/${SEED.ready}/download`,
    proves: "O navegador é instruído a baixar o arquivo (attachment).",
    build: get(`/videos/${SEED.ready}/download`),
    checks: [status(200), { type: "header", name: "content-disposition", matches: /attachment/, label: "Content-Disposition" }],
  },
  {
    id: "M6", section: "media", title: "Download com Range", profile: "anonymous", route: `GET /videos/${SEED.ready}/download (Range: bytes=0-1023)`,
    proves: "Download retomável: aceita Range.", build: rangeGet(`/videos/${SEED.ready}/download`, "bytes=0-1023"), checks: [status(206)],
  },
  {
    id: "M7", section: "media", title: "Download com Range inválido", profile: "anonymous", route: `GET /videos/${SEED.ready}/download (Range: bytes=999999999-)`,
    proves: "Range impossível no download também dá 416.", build: rangeGet(`/videos/${SEED.ready}/download`, "bytes=999999999-"),
    checks: [status(416)],
  },
  {
    id: "M8", section: "media", title: "Thumbnail", profile: "anonymous", route: `GET /videos/${SEED.ready}/thumbnail`,
    proves: "A miniatura é uma imagem JPEG.", build: get(`/videos/${SEED.ready}/thumbnail`),
    checks: [status(200), { type: "header", name: "content-type", matches: /image\/jpeg/, label: "Content-Type" }],
  },
  {
    id: "M9", section: "media", title: "Stream de vídeo PROCESSING (até para o dono)", profile: "owner", route: `GET /videos/${SEED.processing}/stream`,
    proves: "Mídia só existe depois de READY, mesmo para o dono: 404.", build: get(`/videos/${SEED.processing}/stream`), checks: [status(404)],
  },
  {
    id: "M10", section: "media", title: "Thumbnail de vídeo ERROR", profile: "anonymous", route: `GET /videos/${SEED.error}/thumbnail`,
    proves: "Vídeo com erro não tem miniatura: 404.", build: get(`/videos/${SEED.error}/thumbnail`), checks: [status(404)],
  },
  {
    id: "M11", section: "media", title: "Stream de id inexistente", profile: "anonymous", route: `GET /videos/${SEED.missing}/stream`,
    proves: "Id desconhecido: 404.", build: get(`/videos/${SEED.missing}/stream`), checks: [status(404)],
  },

  // ── Upload ─────────────────────────────────────────────────────────────────
  {
    id: "U1", section: "upload", title: "Iniciar upload", profile: "owner", route: "POST /videos/uploads", critical: true,
    proves: "Cria o vídeo em rascunho (DRAFT) e devolve uma parte pré-assinada. O novo vídeo passa a ser usado nos próximos passos.",
    build: () => ({
      method: "POST", path: "/videos/uploads",
      body: { original_filename: SAMPLE_META.filename, mime_type: SAMPLE_META.mime, size_bytes: SAMPLE_META.size },
    }),
    checks: [status(201), { type: "json", path: "status", equals: "DRAFT", label: "status" }, { type: "json", path: "parts.length", equals: 1, label: "partes" }],
    after: (res) => {
      const j = res.json as { id?: string; part_size?: number; parts?: { url?: string }[] } | undefined;
      if (res.status !== 201 || !j?.id) return {};
      return { videoId: j.id, partUrl: j.parts?.[0]?.url, partSize: j.part_size, etag: undefined };
    },
  },
  {
    id: "U1a", section: "upload", title: "Dono vê o rascunho", profile: "owner", route: "GET /videos/:videoId", needs: ["videoId"],
    proves: "O dono enxerga o próprio DRAFT.", build: (c) => ({ method: "GET", path: `/videos/${vid(c)}` }),
    checks: [status(200), { type: "json", path: "status", equals: "DRAFT", label: "status" }],
  },
  {
    id: "U1b", section: "upload", title: "Anônimo não vê o rascunho", profile: "anonymous", route: "GET /videos/:videoId", needs: ["videoId"],
    proves: "Rascunho não é público: 404.", build: (c) => ({ method: "GET", path: `/videos/${vid(c)}` }), checks: [status(404)],
  },
  {
    id: "U2", section: "upload", title: "Enviar a parte 1 ao armazenamento", profile: "owner", route: "PUT <URL pré-assinada> (via servidor)",
    kind: "upload", needs: ["videoId", "partUrl"], critical: true,
    proves: "O arquivo chega ao MinIO e o ETag é devolvido. O envio é feito pelo servidor da página (o navegador não acessa o MinIO).",
    build: () => ({ method: "POST", path: "/upload-part" }),
    checks: [status(200), { type: "jsonPresent", path: "etag", label: "ETag" }],
    after: (res) => {
      const etag = (res.json as { etag?: string } | undefined)?.etag;
      return res.status === 200 && etag ? { etag } : {};
    },
  },
  {
    id: "U3", section: "upload", title: "Renovar a URL da parte", profile: "owner", route: "POST /videos/:videoId/uploads/parts", needs: ["videoId"],
    proves: "Uma nova URL assinada é emitida (só vale em DRAFT).",
    build: (c) => ({ method: "POST", path: `/videos/${vid(c)}/uploads/parts`, body: { part_numbers: [1] } }),
    checks: [status(200), { type: "jsonPresent", path: "parts", label: "parts" }],
  },
  {
    id: "U3a", section: "upload", title: "Parte inexistente (99)", profile: "owner", route: "POST /videos/:videoId/uploads/parts", needs: ["videoId"],
    proves: "Número de parte fora do plano é recusado.",
    build: (c) => ({ method: "POST", path: `/videos/${vid(c)}/uploads/parts`, body: { part_numbers: [99] } }),
    checks: [status(400), code("INVALID_UPLOAD_PARTS")],
  },
  {
    id: "U3b", section: "upload", title: "Lista de partes vazia", profile: "owner", route: "POST /videos/:videoId/uploads/parts", needs: ["videoId"],
    proves: "Corpo inválido é rejeitado pela validação.",
    build: (c) => ({ method: "POST", path: `/videos/${vid(c)}/uploads/parts`, body: { part_numbers: [] } }),
    checks: [status(400), code("VALIDATION_ERROR")],
  },
  {
    id: "U3c", section: "upload", title: "Outro usuário tenta renovar partes", profile: "other", route: "POST /videos/:videoId/uploads/parts", needs: ["videoId"],
    proves: "Só o dono mexe no rascunho; o outro recebe 404 (não revela que existe).",
    build: (c) => ({ method: "POST", path: `/videos/${vid(c)}/uploads/parts`, body: { part_numbers: [1] } }),
    checks: [status(404), code("VIDEO_NOT_FOUND")],
  },
  {
    id: "U4a", section: "upload", title: "Finalizar com corpo inválido", profile: "owner", route: "POST /videos/:videoId/uploads/complete", needs: ["videoId"],
    proves: "Finalizar sem partes é rejeitado.",
    build: (c) => ({ method: "POST", path: `/videos/${vid(c)}/uploads/complete`, body: { parts: [] } }),
    checks: [status(400), code("VALIDATION_ERROR")],
  },
  {
    id: "U4", section: "upload", title: "Finalizar o upload", profile: "owner", route: "POST /videos/:videoId/uploads/complete",
    needs: ["videoId", "etag"], critical: true,
    proves: "O envio é aceito (202) e o vídeo entra em PROCESSING; o worker processa em segundos.",
    build: (c) => ({ method: "POST", path: `/videos/${vid(c)}/uploads/complete`, body: { parts: [{ part_number: 1, etag: c.etag }] } }),
    checks: [status(202), { type: "json", path: "status", equals: "PROCESSING", label: "status" }],
  },
  {
    id: "U4b", section: "upload", title: "Finalizar de novo", profile: "owner", route: "POST /videos/:videoId/uploads/complete", needs: ["videoId", "etag"],
    proves: "Não se finaliza duas vezes: 409.",
    build: (c) => ({ method: "POST", path: `/videos/${vid(c)}/uploads/complete`, body: { parts: [{ part_number: 1, etag: c.etag }] } }),
    checks: [status(409), code("VIDEO_NOT_IN_DRAFT")],
  },
  {
    id: "U4c", section: "upload", title: "Renovar partes após finalizar", profile: "owner", route: "POST /videos/:videoId/uploads/parts", needs: ["videoId"],
    proves: "Depois de finalizado, renovar URL é recusado: 409.",
    build: (c) => ({ method: "POST", path: `/videos/${vid(c)}/uploads/parts`, body: { part_numbers: [1] } }),
    checks: [status(409), code("VIDEO_NOT_IN_DRAFT")],
  },
  {
    id: "U4d", section: "upload", title: "Abortar após finalizar", profile: "owner", route: "DELETE /videos/:videoId/uploads", needs: ["videoId"],
    proves: "Não se aborta um upload já finalizado: 409.",
    build: (c) => ({ method: "DELETE", path: `/videos/${vid(c)}/uploads` }),
    checks: [status(409), code("VIDEO_NOT_IN_DRAFT")],
  },
  {
    id: "U5", section: "upload", title: "Acompanhar o processamento", profile: "owner", route: "GET /videos/:videoId (repetido até READY, máx. 60 s)",
    kind: "poll", needs: ["videoId"],
    proves: "O vídeo percorre PROCESSING → READY em poucos segundos, com duração 6 s, 640×360 e h264.",
    build: (c) => ({ method: "GET", path: `/videos/${vid(c)}` }),
    checks: [status(200), { type: "json", path: "status", equals: "READY", label: "status final" }, ...READY_META],
  },
  {
    id: "U6a", section: "upload", title: "Stream do vídeo novo", profile: "anonymous", route: "GET /videos/:videoId/stream (Range: bytes=0-1023)", needs: ["videoId"],
    proves: "A mídia do vídeo recém-processado é servida (só após READY).",
    build: (c) => ({ method: "GET", path: `/videos/${vid(c)}/stream`, headers: { Range: "bytes=0-1023" } }), checks: [status(206)],
  },
  {
    id: "U6b", section: "upload", title: "Thumbnail gerada pelo worker", profile: "anonymous", route: "GET /videos/:videoId/thumbnail", needs: ["videoId"],
    proves: "O worker gerou a miniatura JPEG.", build: (c) => ({ method: "GET", path: `/videos/${vid(c)}/thumbnail` }),
    checks: [status(200), { type: "header", name: "content-type", matches: /image\/jpeg/, label: "Content-Type" }],
  },
  {
    id: "U6c", section: "upload", title: "Metadados públicos agora que está READY", profile: "anonymous", route: "GET /videos/:videoId", needs: ["videoId"],
    proves: "Depois de pronto, qualquer pessoa vê o vídeo.", build: (c) => ({ method: "GET", path: `/videos/${vid(c)}` }),
    checks: [status(200), { type: "json", path: "status", equals: "READY", label: "status" }],
  },

  // ── Abortar ────────────────────────────────────────────────────────────────
  {
    id: "A1", section: "abort", title: "Iniciar upload para abortar", profile: "owner", route: "POST /videos/uploads", critical: true,
    proves: "Cria um rascunho descartável.",
    build: () => ({ method: "POST", path: "/videos/uploads", body: { original_filename: "para-abortar.mp4", mime_type: "video/mp4", size_bytes: SAMPLE_SIZE_BYTES } }),
    checks: [status(201)],
    after: (res) => {
      const id = (res.json as { id?: string } | undefined)?.id;
      return res.status === 201 && id ? { abortVideoId: id } : {};
    },
  },
  {
    id: "A2", section: "abort", title: "Abortar o rascunho", profile: "owner", route: "DELETE /videos/:abortVideoId/uploads", needs: ["abortVideoId"],
    proves: "O rascunho é cancelado (204, sem corpo).",
    build: (c) => ({ method: "DELETE", path: `/videos/${c.abortVideoId ?? ""}/uploads` }), checks: [status(204)],
  },
  {
    id: "A3", section: "abort", title: "Abortar de novo", profile: "owner", route: "DELETE /videos/:abortVideoId/uploads", needs: ["abortVideoId"],
    proves: "O rascunho já não existe: 404 VIDEO_NOT_FOUND.",
    build: (c) => ({ method: "DELETE", path: `/videos/${c.abortVideoId ?? ""}/uploads` }), checks: [status(404), code("VIDEO_NOT_FOUND")],
  },

  // ── Erros ──────────────────────────────────────────────────────────────────
  {
    id: "E1", section: "errors", title: "Iniciar upload sem token", profile: "anonymous", route: "POST /videos/uploads",
    proves: "Upload exige login: 401.",
    build: () => ({ method: "POST", path: "/videos/uploads", body: { original_filename: "sample.mp4", mime_type: "video/mp4", size_bytes: SAMPLE_SIZE_BYTES } }),
    checks: [status(401)],
  },
  {
    id: "E2", section: "errors", title: "Arquivo que não é vídeo (PDF)", profile: "owner", route: "POST /videos/uploads",
    proves: "Só tipos de vídeo são aceitos.",
    build: () => ({ method: "POST", path: "/videos/uploads", body: { original_filename: "documento.pdf", mime_type: "application/pdf", size_bytes: 1000 } }),
    checks: [status(400), code("VALIDATION_ERROR")],
  },
  {
    id: "E3", section: "errors", title: "Tamanho acima de 10 GB", profile: "owner", route: "POST /videos/uploads",
    proves: "O limite de 10 GB é imposto.",
    build: () => ({ method: "POST", path: "/videos/uploads", body: { original_filename: "enorme.mp4", mime_type: "video/mp4", size_bytes: 10737418241 } }),
    checks: [status(400), code("VALIDATION_ERROR")],
  },
  {
    id: "E4", section: "errors", title: "Vídeo inexistente", profile: "owner", route: `POST /videos/${SEED.missing}/uploads/parts`,
    proves: "Id desconhecido: 404 VIDEO_NOT_FOUND.",
    build: () => ({ method: "POST", path: `/videos/${SEED.missing}/uploads/parts`, body: { part_numbers: [1] } }),
    checks: [status(404), code("VIDEO_NOT_FOUND")],
  },
  {
    id: "E5", section: "errors", title: "Abortar sem token", profile: "anonymous", route: "DELETE /videos/:abortVideoId/uploads",
    proves: "Abortar exige login: 401 (a autenticação vem antes de procurar o vídeo).",
    build: (c) => ({ method: "DELETE", path: `/videos/${c.abortVideoId ?? SEED.missing}/uploads` }), checks: [status(401)],
  },
];

export function stepsOf(section: SectionId): StepDef[] {
  return STEPS.filter((s) => s.section === section);
}
