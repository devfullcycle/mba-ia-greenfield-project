import {
  mkdtempSync,
  readdirSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { createServer, type IncomingHttpHeaders, type Server } from 'http';
import {
  type AddressInfo,
  createServer as createNetServer,
  type Server as NetServer,
  type Socket,
} from 'net';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  createPartPutter,
  MAX_CONCURRENCY,
  mimeTypeFor,
  parseConcurrency,
  type PartPutter,
  type UploadApi,
  uploadFile,
} from './multipart-uploader';

const PART_SIZE = 10;
const SIZE = 25; // parts: [0-9], [10-19], [20-24]

function fakeApi(): jest.Mocked<UploadApi> {
  return {
    initiate: jest.fn().mockResolvedValue({
      id: 'public-id',
      part_size: PART_SIZE,
      part_count: 3,
      parts: [1, 2, 3].map((n) => ({ part_number: n, url: `old-${n}` })),
    }),
    renewParts: jest.fn((_id: string, partNumbers: number[]) =>
      Promise.resolve(
        partNumbers.map((n) => ({ part_number: n, url: `new-${n}` })),
      ),
    ),
    complete: jest.fn<
      ReturnType<UploadApi['complete']>,
      Parameters<UploadApi['complete']>
    >((id) => Promise.resolve({ id, status: 'PROCESSING' })),
    abort: jest.fn().mockResolvedValue(undefined),
  };
}

const upload = (
  api: UploadApi,
  putPart: PartPutter,
  warn: (message: string) => void = jest.fn(),
) =>
  uploadFile({
    filePath: '/fake/file.mp4',
    filename: 'file.mp4',
    mimeType: 'video/mp4',
    sizeBytes: SIZE,
    api,
    putPart,
    concurrency: 1,
    retryDelayMs: 0,
    warn,
  });

describe('uploadFile', () => {
  it('should slice the file by part_size and complete with every ETag in order', async () => {
    const api = fakeApi();
    const putPart = jest.fn<ReturnType<PartPutter>, Parameters<PartPutter>>(
      (url) => Promise.resolve({ status: 200, etag: `"etag-${url}"` }),
    );

    const result = await upload(api, putPart);

    expect(api.initiate).toHaveBeenCalledWith({
      original_filename: 'file.mp4',
      mime_type: 'video/mp4',
      size_bytes: SIZE,
    });
    expect(putPart.mock.calls.map(([, , start, end]) => [start, end])).toEqual([
      [0, 9],
      [10, 19],
      [20, 24],
    ]);
    expect(api.complete).toHaveBeenCalledWith('public-id', [
      { part_number: 1, etag: '"etag-old-1"' },
      { part_number: 2, etag: '"etag-old-2"' },
      { part_number: 3, etag: '"etag-old-3"' },
    ]);
    expect(result).toEqual({ id: 'public-id', status: 'PROCESSING' });
    expect(api.abort).not.toHaveBeenCalled();
  });

  it('should renew only pending parts after a 403 and not resend confirmed ones', async () => {
    const api = fakeApi();
    const putPart = jest.fn((url: string) =>
      Promise.resolve(
        url === 'old-2' || url === 'old-3'
          ? { status: 403 }
          : { status: 200, etag: `"${url}"` },
      ),
    );

    await upload(api, putPart);

    expect(api.renewParts).toHaveBeenCalledTimes(1);
    expect(api.renewParts).toHaveBeenCalledWith('public-id', [2, 3]);
    const urls = putPart.mock.calls.map(([url]) => url);
    expect(urls.filter((url) => url.endsWith('-1'))).toEqual(['old-1']);
    expect(api.complete).toHaveBeenCalledWith('public-id', [
      { part_number: 1, etag: '"old-1"' },
      { part_number: 2, etag: '"new-2"' },
      { part_number: 3, etag: '"new-3"' },
    ]);
  });

  it('should share one renewal across workers when every URL expires at once', async () => {
    const api = fakeApi();
    const putPart = jest.fn((url: string) =>
      Promise.resolve(
        url.startsWith('old-')
          ? { status: 403 }
          : { status: 200, etag: `"${url}"` },
      ),
    );

    await uploadFile({
      filePath: '/fake/file.mp4',
      filename: 'file.mp4',
      mimeType: 'video/mp4',
      sizeBytes: SIZE,
      api,
      putPart,
      concurrency: 3,
      maxAttempts: 1, // an expiry must not consume the only attempt
      retryDelayMs: 0,
    });

    expect(api.renewParts).toHaveBeenCalledTimes(1);
    expect(api.complete).toHaveBeenCalledTimes(1);
  });

  it('should fail definitively with a clear error when a part gets 403 even after renewal', async () => {
    const api = fakeApi();
    const putPart = jest.fn(() => Promise.resolve({ status: 403 }));

    await expect(upload(api, putPart)).rejects.toThrow(
      /Part 1 failed: HTTP 403 even with a freshly renewed URL.*--storage-connect/,
    );

    expect(api.renewParts).toHaveBeenCalledTimes(1);
    expect(putPart).toHaveBeenCalledTimes(2);
    expect(api.complete).not.toHaveBeenCalled();
    expect(api.abort).toHaveBeenCalledWith('public-id');
  });

  it.each([0, -1, NaN, 1.5, MAX_CONCURRENCY + 1])(
    'should reject concurrency %p before initiating the upload',
    async (concurrency) => {
      const api = fakeApi();

      await expect(
        uploadFile({
          filePath: '/fake/file.mp4',
          filename: 'file.mp4',
          mimeType: 'video/mp4',
          sizeBytes: SIZE,
          api,
          putPart: jest.fn(),
          concurrency,
        }),
      ).rejects.toThrow('Invalid concurrency');
      expect(api.initiate).not.toHaveBeenCalled();
    },
  );

  it('should retry a part after a network error without restarting the upload', async () => {
    const api = fakeApi();
    let failed = false;
    const putPart = jest.fn((url: string) => {
      if (url === 'old-2' && !failed) {
        failed = true;
        return Promise.reject(new Error('ECONNRESET'));
      }
      return Promise.resolve({ status: 200, etag: `"${url}"` });
    });

    await upload(api, putPart);

    expect(api.initiate).toHaveBeenCalledTimes(1);
    expect(putPart.mock.calls.map(([url]) => url)).toEqual([
      'old-1',
      'old-2',
      'old-2',
      'old-3',
    ]);
    expect(api.complete).toHaveBeenCalledTimes(1);
  });

  it('should fail after exhausting the attempts for a part and never complete', async () => {
    const api = fakeApi();
    const putPart = jest.fn(() => Promise.resolve({ status: 500 }));

    await expect(upload(api, putPart)).rejects.toThrow('Part 1 failed');
    expect(api.complete).not.toHaveBeenCalled();
  });

  it('should abort the upload exactly once and rethrow the original error when a part fails definitively', async () => {
    const api = fakeApi();
    const putPart = jest.fn(() => Promise.resolve({ status: 500 }));

    await expect(upload(api, putPart)).rejects.toThrow(
      'Part 1 failed: HTTP 500',
    );

    expect(api.abort).toHaveBeenCalledTimes(1);
    expect(api.abort).toHaveBeenCalledWith('public-id');
  });

  it('should stop taking new parts and abort only after in-flight parts settle', async () => {
    const api = fakeApi();
    const events: string[] = [];
    api.abort.mockImplementation(() => {
      events.push('abort');
      return Promise.resolve();
    });
    const putPart = jest.fn(async (url: string) => {
      events.push(`put ${url}`);
      if (url === 'old-1') return { status: 500 };
      await new Promise((resolve) => setTimeout(resolve, 5));
      events.push(`done ${url}`);
      return { status: 200, etag: `"${url}"` };
    });

    await expect(
      uploadFile({
        filePath: '/fake/file.mp4',
        filename: 'file.mp4',
        mimeType: 'video/mp4',
        sizeBytes: SIZE,
        api,
        putPart,
        concurrency: 2,
        maxAttempts: 1,
        retryDelayMs: 0,
        warn: jest.fn(),
      }),
    ).rejects.toThrow('Part 1 failed');

    expect(events).toEqual(['put old-1', 'put old-2', 'done old-2', 'abort']);
  });

  it('should not let an abort failure mask the original error, and report it', async () => {
    const api = fakeApi();
    api.abort.mockRejectedValue(new Error('DELETE -> 500'));
    const warn = jest.fn();
    const putPart = jest.fn(() => Promise.resolve({ status: 500 }));

    await expect(upload(api, putPart, warn)).rejects.toThrow('Part 1 failed');

    expect(api.abort).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('DELETE -> 500'));
  });

  it('should abort when complete fails', async () => {
    const api = fakeApi();
    api.complete.mockRejectedValue(new Error('POST complete -> 400'));
    const putPart = jest.fn((url: string) =>
      Promise.resolve({ status: 200, etag: `"${url}"` }),
    );

    await expect(upload(api, putPart)).rejects.toThrow('POST complete -> 400');
    expect(api.abort).toHaveBeenCalledTimes(1);
  });

  it('should not abort when initiate itself fails', async () => {
    const api = fakeApi();
    api.initiate.mockRejectedValue(new Error('POST /videos/uploads -> 401'));

    await expect(upload(api, jest.fn())).rejects.toThrow('401');
    expect(api.abort).not.toHaveBeenCalled();
  });
});

describe('mimeTypeFor', () => {
  it('should map video extensions and reject unknown ones', () => {
    expect(mimeTypeFor('/a/clip.MP4')).toBe('video/mp4');
    expect(mimeTypeFor('clip.webm')).toBe('video/webm');
    expect(() => mimeTypeFor('notes.txt')).toThrow('Unsupported');
  });
});

describe('parseConcurrency', () => {
  it('should accept integers from 1 to MAX_CONCURRENCY', () => {
    expect(parseConcurrency('1')).toBe(1);
    expect(parseConcurrency(String(MAX_CONCURRENCY))).toBe(MAX_CONCURRENCY);
  });

  it.each(['abc', '', '0', '-2', '2.5', '1e1', String(MAX_CONCURRENCY + 1)])(
    'should reject %p',
    (raw) => {
      expect(() => parseConcurrency(raw)).toThrow(/Invalid (--)?concurrency/);
    },
  );
});

describe('createPartPutter with a stalled server', () => {
  let server: Server;
  let port: number;
  let requests: number;
  let respondFrom: number;
  let dir: string;
  let filePath: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'uploader-stall-'));
    filePath = join(dir, 'file.mp4');
    writeFileSync(filePath, 'x'.repeat(SIZE));
    // Reads the body but never answers until request number `respondFrom`.
    server = createServer((req, res) => {
      requests++;
      const current = requests;
      req.resume();
      req.on('end', () => {
        if (current >= respondFrom) {
          res.writeHead(200, { ETag: `"etag-${current}"` }).end();
        }
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    port = (server.address() as AddressInfo).port;
  });

  beforeEach(() => {
    requests = 0;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  });

  const stalledUpload = (api: UploadApi, maxAttempts: number) =>
    uploadFile({
      filePath,
      filename: 'file.mp4',
      mimeType: 'video/mp4',
      sizeBytes: SIZE,
      api,
      putPart: createPartPutter(undefined, { timeoutMs: 50 }),
      concurrency: 1,
      maxAttempts,
      retryDelayMs: 0,
      warn: jest.fn(),
    });

  const apiFor = () => {
    const api = fakeApi();
    api.initiate.mockResolvedValue({
      id: 'public-id',
      part_size: SIZE,
      part_count: 1,
      parts: [{ part_number: 1, url: `http://127.0.0.1:${port}/bucket/key` }],
    });
    return api;
  };

  it('should time out an unanswered PUT with a network error', async () => {
    respondFrom = Infinity;
    const putPart = createPartPutter(undefined, { timeoutMs: 50 });

    await expect(
      putPart(`http://127.0.0.1:${port}/bucket/key`, filePath, 0, 4),
    ).rejects.toThrow('timed out after 50ms');
  });

  it('should retry a timed-out part and complete', async () => {
    respondFrom = 2;
    const api = apiFor();

    await stalledUpload(api, 3);

    expect(requests).toBe(2);
    expect(api.complete).toHaveBeenCalledWith('public-id', [
      { part_number: 1, etag: '"etag-2"' },
    ]);
  });

  it('should fail definitively and abort after every attempt times out', async () => {
    respondFrom = Infinity;
    const api = apiFor();

    await expect(stalledUpload(api, 2)).rejects.toThrow(
      'Part 1 failed: Part PUT timed out',
    );
    expect(requests).toBe(2);
    expect(api.abort).toHaveBeenCalledTimes(1);
  });
});

describe('createPartPutter resource cleanup', () => {
  const BIG_SIZE = 8 * 1024 * 1024; // far above socket buffers: forces backpressure
  let server: NetServer;
  const sockets = new Set<Socket>();
  let port: number;
  let dir: string;
  let filePath: string;

  /** Open fds of this process that point at `path` (Linux /proc). */
  const openFdsFor = (path: string): number =>
    readdirSync('/proc/self/fd').filter((fd) => {
      try {
        return readlinkSync(`/proc/self/fd/${fd}`) === path;
      } catch {
        return false; // fd closed while listing
      }
    }).length;

  const waitForNoFds = async (path: string): Promise<number> => {
    for (let i = 0; i < 50 && openFdsFor(path) > 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return openFdsFor(path);
  };

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'uploader-fd-'));
    filePath = join(dir, 'file.mp4');
    writeFileSync(filePath, Buffer.alloc(BIG_SIZE));
    // Accepts the connection but never reads: the PUT body stalls mid-stream.
    server = createNetServer((socket) => {
      sockets.add(socket);
      socket.pause();
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    // Paused sockets never read the client's FIN, so close them explicitly.
    sockets.forEach((socket) => socket.destroy());
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  });

  it('should destroy the file read stream after a timed-out PUT', async () => {
    const putPart = createPartPutter(undefined, { timeoutMs: 100 });

    await expect(
      putPart(`http://127.0.0.1:${port}/bucket/key`, filePath, 0, BIG_SIZE - 1),
    ).rejects.toThrow('timed out after 100ms');

    expect(await waitForNoFds(filePath)).toBe(0);
  });

  it('should time out a stalled TCP connect with the same retryable error', async () => {
    // Non-routable address: SYN is dropped, so only the pre-connect timeout ends it.
    const putPart = createPartPutter('10.255.255.1:9000', { timeoutMs: 100 });
    const startedAt = Date.now();

    await expect(
      putPart('http://localhost:9000/bucket/key', filePath, 0, 9),
    ).rejects.toThrow('Part PUT timed out after 100ms idle');

    expect(Date.now() - startedAt).toBeLessThan(2_000);
    expect(await waitForNoFds(filePath)).toBe(0);
  });
});

describe('createPartPutter', () => {
  let server: Server;
  let port: number;
  let received: { headers: IncomingHttpHeaders; url?: string; body: string }[];
  let dir: string;
  let filePath: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'uploader-'));
    filePath = join(dir, 'file.mp4');
    writeFileSync(filePath, '0123456789abcdefghij');
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString()));
      req.on('end', () => {
        received.push({ headers: req.headers, url: req.url, body });
        res.writeHead(200, { ETag: '"etag-from-server"' }).end();
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    port = (server.address() as AddressInfo).port;
  });

  beforeEach(() => {
    received = [];
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  });

  it('should connect to --storage-connect while keeping the signed URL Host header', async () => {
    const putPart = createPartPutter(`127.0.0.1:${port}`);

    const result = await putPart(
      'http://localhost:9000/streamtube/videos/x/source?X-Amz-Signature=abc',
      filePath,
      10,
      19,
    );

    expect(result).toEqual({ status: 200, etag: '"etag-from-server"' });
    expect(received).toHaveLength(1);
    expect(received[0].headers.host).toBe('localhost:9000');
    expect(received[0].url).toBe(
      '/streamtube/videos/x/source?X-Amz-Signature=abc',
    );
    expect(received[0].body).toBe('abcdefghij');
  });

  it('should connect to the URL host itself without --storage-connect', async () => {
    const putPart = createPartPutter();

    await putPart(`http://127.0.0.1:${port}/bucket/key`, filePath, 0, 4);

    expect(received[0].headers.host).toBe(`127.0.0.1:${port}`);
    expect(received[0].body).toBe('01234');
  });
});
