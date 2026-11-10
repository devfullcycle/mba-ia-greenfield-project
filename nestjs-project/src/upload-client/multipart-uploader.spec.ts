import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { createServer, type IncomingHttpHeaders, type Server } from 'http';
import type { AddressInfo } from 'net';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  createPartPutter,
  mimeTypeFor,
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
  };
}

const upload = (api: UploadApi, putPart: PartPutter) =>
  uploadFile({
    filePath: '/fake/file.mp4',
    filename: 'file.mp4',
    mimeType: 'video/mp4',
    sizeBytes: SIZE,
    api,
    putPart,
    concurrency: 1,
    retryDelayMs: 0,
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
});

describe('mimeTypeFor', () => {
  it('should map video extensions and reject unknown ones', () => {
    expect(mimeTypeFor('/a/clip.MP4')).toBe('video/mp4');
    expect(mimeTypeFor('clip.webm')).toBe('video/webm');
    expect(() => mimeTypeFor('notes.txt')).toThrow('Unsupported');
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
