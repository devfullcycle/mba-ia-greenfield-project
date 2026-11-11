import { createReadStream } from 'fs';
import { request as httpRequest } from 'http';
import { extname } from 'path';

/**
 * Client side of the upload handshake (TD-04/TD-05). Framework-free so it can
 * be used by the CLI script and by tests. Reads the file part by part, so
 * memory stays proportional to part_size × concurrency, not file size.
 */

export interface PartUrl {
  part_number: number;
  url: string;
}

export interface InitiatedUpload {
  id: string;
  part_size: number;
  part_count: number;
  parts: PartUrl[];
}

export interface CompletedUpload {
  id: string;
  status: string;
}

export interface UploadApi {
  initiate: (body: {
    original_filename: string;
    mime_type: string;
    size_bytes: number;
  }) => Promise<InitiatedUpload>;
  renewParts: (id: string, partNumbers: number[]) => Promise<PartUrl[]>;
  complete: (
    id: string,
    parts: { part_number: number; etag: string }[],
  ) => Promise<CompletedUpload>;
  abort: (id: string) => Promise<void>;
}

export interface PartResult {
  status: number;
  etag?: string;
}

/** PUTs bytes [start, end] (inclusive) of `filePath` to a presigned URL. */
export type PartPutter = (
  url: string,
  filePath: string,
  start: number,
  end: number,
) => Promise<PartResult>;

export interface UploadOptions {
  filePath: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  api: UploadApi;
  putPart: PartPutter;
  concurrency?: number;
  maxAttempts?: number;
  retryDelayMs?: number;
  /** Receives non-fatal diagnostics, e.g. a failed best-effort abort. */
  warn?: (message: string) => void;
}

const URL_EXPIRED_STATUS = 403;

const MIME_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/x-m4v',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
};

export function mimeTypeFor(filePath: string): string {
  const mimeType = MIME_TYPES[extname(filePath).toLowerCase()];
  if (!mimeType) {
    throw new Error(`Unsupported video extension: ${extname(filePath)}`);
  }
  return mimeType;
}

class PartUploadError extends Error {
  constructor(partNumber: number, detail: string) {
    super(`Part ${partNumber} failed: ${detail}`);
    this.name = 'PartUploadError';
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function uploadFile(
  options: UploadOptions,
): Promise<CompletedUpload> {
  const {
    api,
    putPart,
    filePath,
    sizeBytes,
    concurrency = 4,
    maxAttempts = 5,
    retryDelayMs = 500,
    warn = (message: string) => console.error(message),
  } = options;

  const upload = await api.initiate({
    original_filename: options.filename,
    mime_type: options.mimeType,
    size_bytes: sizeBytes,
  });

  try {
    return await transferParts(upload, {
      api,
      putPart,
      filePath,
      sizeBytes,
      concurrency,
      maxAttempts,
      retryDelayMs,
    });
  } catch (err) {
    // Definitive failure: release the draft so it doesn't linger. Best-effort —
    // an abort failure is reported but never replaces the original error.
    try {
      await api.abort(upload.id);
    } catch (abortErr) {
      warn(
        `Abort of upload ${upload.id} failed: ${
          abortErr instanceof Error ? abortErr.message : String(abortErr)
        }`,
      );
    }
    throw err;
  }
}

type TransferSettings = Required<
  Pick<
    UploadOptions,
    | 'api'
    | 'putPart'
    | 'filePath'
    | 'sizeBytes'
    | 'concurrency'
    | 'maxAttempts'
    | 'retryDelayMs'
  >
>;

/** Uploads every part (with retries and URL renewal) and completes the upload. */
async function transferParts(
  upload: InitiatedUpload,
  settings: TransferSettings,
): Promise<CompletedUpload> {
  const {
    api,
    putPart,
    filePath,
    sizeBytes,
    concurrency,
    maxAttempts,
    retryDelayMs,
  } = settings;
  const urls = new Map(upload.parts.map((p) => [p.part_number, p.url]));
  const etags = new Map<number, string>();
  let renewal: Promise<void> | null = null;

  /** Re-signs every part not confirmed yet; concurrent callers share one request. */
  const renewPending = (): Promise<void> => {
    renewal ??= (async () => {
      const pending = [...urls.keys()].filter((n) => !etags.has(n));
      for (const part of await api.renewParts(upload.id, pending)) {
        urls.set(part.part_number, part.url);
      }
    })().finally(() => {
      renewal = null;
    });
    return renewal;
  };

  const uploadPart = async (partNumber: number): Promise<void> => {
    const start = (partNumber - 1) * upload.part_size;
    const end = Math.min(start + upload.part_size, sizeBytes) - 1;
    for (let attempt = 1; ; attempt++) {
      let failure: string;
      try {
        const result = await putPart(
          urls.get(partNumber)!,
          filePath,
          start,
          end,
        );
        if (result.status >= 200 && result.status < 300 && result.etag) {
          etags.set(partNumber, result.etag);
          return;
        }
        if (result.status === URL_EXPIRED_STATUS) {
          // Expired URL: renew and retry without consuming an attempt.
          await renewPending();
          attempt--;
          continue;
        }
        failure = `HTTP ${result.status}`;
      } catch (err) {
        failure = err instanceof Error ? err.message : String(err);
      }
      if (attempt >= maxAttempts) {
        throw new PartUploadError(partNumber, failure);
      }
      await sleep(retryDelayMs * attempt);
    }
  };

  const queue = Array.from({ length: upload.part_count }, (_, i) => i + 1);
  const workers = Array.from(
    { length: Math.min(concurrency, queue.length) },
    async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        try {
          await uploadPart(next);
        } catch (err) {
          queue.length = 0; // stop the other workers from taking new parts
          throw err;
        }
      }
    },
  );
  // Wait for in-flight parts so no PUT races the caller's abort.
  const failure = (await Promise.allSettled(workers)).find(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  if (failure) {
    throw failure.reason;
  }

  return api.complete(
    upload.id,
    [...etags.entries()]
      .sort(([a], [b]) => a - b)
      .map(([part_number, etag]) => ({ part_number, etag })),
  );
}

/**
 * Streams a file slice to a presigned URL. With `storageConnect` ("host:port")
 * the TCP connection goes there while the Host header keeps the signed URL's
 * host (SigV4 signatures are host-bound) — e.g. reaching `minio:9000` from
 * inside Compose with URLs signed for `localhost:9000`.
 */
export function createPartPutter(storageConnect?: string): PartPutter {
  const [connectHost, connectPort] = storageConnect?.split(':') ?? [];
  return (url, filePath, start, end) =>
    new Promise((resolve, reject) => {
      const target = new URL(url);
      const req = httpRequest(
        {
          method: 'PUT',
          host: connectHost || target.hostname,
          port: Number(connectPort || target.port || 80),
          path: `${target.pathname}${target.search}`,
          headers: { Host: target.host, 'Content-Length': end - start + 1 },
        },
        (res) => {
          res.resume();
          res.on('end', () =>
            resolve({
              status: res.statusCode ?? 0,
              etag: res.headers.etag,
            }),
          );
        },
      );
      req.on('error', reject);
      const body = createReadStream(filePath, { start, end });
      body.on('error', (err) => req.destroy(err));
      body.pipe(req);
    });
}

/** UploadApi over the StreamTube REST endpoints. */
export function createHttpApi(apiBaseUrl: string, token: string): UploadApi {
  const send = async (
    method: 'POST' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<Response> => {
    const res = await fetch(new URL(path, apiBaseUrl), {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(
        `${method} ${path} -> ${res.status}: ${await res.text()}`,
      );
    }
    return res;
  };
  const call = async <T>(path: string, body: unknown): Promise<T> =>
    (await (await send('POST', path, body)).json()) as T;
  return {
    initiate: (body) => call<InitiatedUpload>('/videos/uploads', body),
    renewParts: async (id, partNumbers) =>
      (
        await call<{ parts: PartUrl[] }>(`/videos/${id}/uploads/parts`, {
          part_numbers: partNumbers,
        })
      ).parts,
    complete: (id, parts) =>
      call<CompletedUpload>(`/videos/${id}/uploads/complete`, { parts }),
    abort: async (id) => {
      await send('DELETE', `/videos/${id}/uploads`);
    },
  };
}
