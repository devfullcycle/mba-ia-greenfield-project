import { stat } from 'fs/promises';
import { basename } from 'path';
import { parseArgs } from 'util';
import {
  createHttpApi,
  createPartPutter,
  mimeTypeFor,
  uploadFile,
} from '../src/upload-client/multipart-uploader';

const USAGE =
  'Usage: npm run upload:video -- --file <path> --api <url> --token <access_token> [--concurrency N] [--storage-connect host:port]';

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      file: { type: 'string' },
      api: { type: 'string' },
      token: { type: 'string' },
      concurrency: { type: 'string', default: '4' },
      'storage-connect': { type: 'string' },
    },
  });
  if (!values.file || !values.api || !values.token) {
    throw new Error(USAGE);
  }

  const { size } = await stat(values.file);
  const startedAt = Date.now();
  const result = await uploadFile({
    filePath: values.file,
    filename: basename(values.file),
    mimeType: mimeTypeFor(values.file),
    sizeBytes: size,
    api: createHttpApi(values.api, values.token),
    putPart: createPartPutter(values['storage-connect']),
    concurrency: Number(values.concurrency),
  });

  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`id=${result.id} status=${result.status} size=${size} time=${seconds}s`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
