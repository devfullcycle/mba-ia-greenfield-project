import { DeleteObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { randomBytes, randomUUID } from 'crypto';
import type { Readable } from 'stream';
import { RangeNotSatisfiableException } from '../common/exceptions/domain.exception';
import { S3_INTERNAL_CLIENT } from '../storage/storage.constants';
import { StorageModule } from '../storage/storage.module';
import { StorageService } from '../storage/storage.service';
import type { Video } from './entities/video.entity';
import { MediaDeliveryService } from './media-delivery.service';

const SIZE = 4096;

const readAll = async (stream: Readable): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
};

describe('MediaDeliveryService (integration)', () => {
  let module: TestingModule;
  let delivery: MediaDeliveryService;
  let content: Buffer;
  let video: Video;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), StorageModule],
      providers: [MediaDeliveryService],
    }).compile();
    delivery = module.get(MediaDeliveryService);

    content = randomBytes(SIZE);
    const key = `test/media/${randomUUID()}`;
    await module.get(StorageService).putObject(key, content, 'video/mp4');
    video = {
      storage_key: key,
      mime_type: 'video/mp4',
      size_bytes: SIZE,
    } as Video;
  });

  afterAll(async () => {
    await module.get<S3Client>(S3_INTERNAL_CLIENT).send(
      new DeleteObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: video.storage_key,
      }),
    );
    await module.close();
  });

  it('should return 206 with the matching Content-Range for a partial range', async () => {
    const media = await delivery.openMedia(video, 'bytes=0-1023');
    const body = await readAll(media.body);

    expect(media.status).toBe(206);
    expect(media.headers['Content-Range']).toBe(`bytes 0-1023/${SIZE}`);
    expect(media.headers['Content-Length']).toBe('1024');
    expect(media.headers['Accept-Ranges']).toBe('bytes');
    expect(body.equals(content.subarray(0, 1024))).toBe(true);
  });

  it('should return 200 with the full Content-Length without a range', async () => {
    const media = await delivery.openMedia(video);
    const body = await readAll(media.body);

    expect(media.status).toBe(200);
    expect(media.headers['Content-Length']).toBe(String(SIZE));
    expect(media.headers['Content-Type']).toBe('video/mp4');
    expect(media.headers['Content-Range']).toBeUndefined();
    expect(body.equals(content)).toBe(true);
  });

  it('should throw RANGE_NOT_SATISFIABLE carrying the object size for a range past the end', async () => {
    const failure = delivery.openMedia(video, `bytes=${SIZE}-`);

    await expect(failure).rejects.toBeInstanceOf(RangeNotSatisfiableException);
    await expect(failure).rejects.toMatchObject({ objectSize: SIZE });
  });
});
