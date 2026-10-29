import { execFile, execFileSync } from 'child_process';
import { randomUUID } from 'crypto';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { Channel } from '../channels/entities/channel.entity';
import storageConfig from '../config/storage.config';
import { PROCESS_VIDEO_JOB } from '../queue/queue.constants';
import { S3_INTERNAL_CLIENT } from '../storage/storage.constants';
import { StorageModule } from '../storage/storage.module';
import { StorageService } from '../storage/storage.service';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import { User } from '../users/entities/user.entity';
import { Video } from '../videos/entities/video.entity';
import { ProcessingStatus } from '../videos/video.enums';
import { thumbnailKey } from '../videos/videos.constants';
import { MediaProbeService } from './media-probe.service';
import { StaleUploadSweeper } from './stale-upload.sweeper';
import { VideoProcessor } from './video.processor';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];

function hasFfmpeg(): boolean {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// FFmpeg is only installed in the video-worker image. In the API container
// this suite is skipped; run it with:
//   docker compose exec video-worker npx jest src/worker/video.processor.integration-spec.ts
const describeWithFfmpeg = hasFfmpeg() ? describe : describe.skip;

describeWithFfmpeg(
  'VideoProcessor (integration, real FFmpeg and storage)',
  () => {
    let dataSource: DataSource;
    let videoRepository: Repository<Video>;
    let userRepository: Repository<User>;
    let channelRepository: Repository<Channel>;
    let module: TestingModule;
    let storageService: StorageService;
    let s3Client: S3Client;
    let processor: VideoProcessor;
    let workDir: string;
    let sampleMp4: Buffer;
    const createdKeys: string[] = [];

    beforeAll(async () => {
      workDir = await mkdtemp(join(tmpdir(), 'processor-spec-'));
      const samplePath = join(workDir, 'sample.mp4');
      await promisify(execFile)('ffmpeg', [
        '-y',
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'testsrc=duration=3:size=320x240:rate=10',
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        samplePath,
      ]);
      sampleMp4 = await readFile(samplePath);

      dataSource = createTestDataSource(ALL_ENTITIES);
      await dataSource.initialize();
      videoRepository = dataSource.getRepository(Video);
      userRepository = dataSource.getRepository(User);
      channelRepository = dataSource.getRepository(Channel);

      module = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({ isGlobal: true, load: [storageConfig] }),
          StorageModule,
        ],
      }).compile();
      storageService = module.get(StorageService);
      s3Client = module.get<S3Client>(S3_INTERNAL_CLIENT);

      processor = new VideoProcessor(
        videoRepository,
        storageService,
        new MediaProbeService(promisify(execFile)),
        new StaleUploadSweeper(videoRepository, storageService),
      );
    });

    afterAll(async () => {
      const { bucket } = storageConfig();
      await Promise.all(
        createdKeys.map((key) =>
          s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })),
        ),
      );
      await module.close();
      await dataSource.destroy();
      await rm(workDir, { recursive: true, force: true });
    });

    beforeEach(async () => {
      await cleanAllTables(dataSource);
    });

    let counter = 0;
    async function createProcessingVideo(content: Buffer): Promise<Video> {
      const n = ++counter;
      const user = await userRepository.save(
        userRepository.create({
          email: `processor_${n}@example.com`,
          password: 'hashed',
        }),
      );
      const channel = await channelRepository.save(
        channelRepository.create({
          name: `Processor ${n}`,
          nickname: `processor_${n}`,
          user_id: user.id,
        }),
      );
      const id = randomUUID();
      const objectKey = `test/${id}/original.mp4`;
      createdKeys.push(objectKey, thumbnailKey(id));
      await storageService.putObject(objectKey, content, 'video/mp4');
      return videoRepository.save(
        videoRepository.create({
          id,
          publicId: `proc${String(n).padStart(7, '0')}`,
          channelId: channel.id,
          originalFilename: 'clip.mp4',
          contentType: 'video/mp4',
          sizeBytes: String(content.length),
          objectKey,
          processingStatus: ProcessingStatus.PROCESSING,
        }),
      );
    }

    function job(videoId: string, attemptsMade = 0, attempts = 3) {
      return {
        name: PROCESS_VIDEO_JOB,
        data: { videoId },
        attemptsMade,
        opts: { attempts },
      } as never;
    }

    it('should extract duration and metadata, store the thumbnail and mark the video READY', async () => {
      const video = await createProcessingVideo(sampleMp4);

      await processor.process(job(video.id));

      const stored = await videoRepository.findOneByOrFail({ id: video.id });
      expect(stored.processingStatus).toBe(ProcessingStatus.READY);
      expect(Number(stored.durationSeconds)).toBeCloseTo(3, 0);
      expect(stored.metadata).toMatchObject({
        video: { codec: 'h264', width: 320, height: 240 },
      });
      const thumbnail = await storageService.headObject(thumbnailKey(video.id));
      expect(thumbnail?.contentLength).toBeGreaterThan(0);
    });

    it('should be idempotent: a second run on a READY video changes nothing', async () => {
      const video = await createProcessingVideo(sampleMp4);
      await processor.process(job(video.id));
      const first = await videoRepository.findOneByOrFail({ id: video.id });

      await processor.process(job(video.id));

      const second = await videoRepository.findOneByOrFail({ id: video.id });
      expect(second.updatedAt).toEqual(first.updatedAt);
      expect(second.durationSeconds).toBe(first.durationSeconds);
    });

    it('should reject a file without a video stream and leave the video PROCESSING until retries are exhausted', async () => {
      const video = await createProcessingVideo(
        Buffer.from('not a video at all'),
      );

      await expect(processor.process(job(video.id))).rejects.toThrow();
      await processor.onFailed(job(video.id, 1), new Error('first failure'));

      const afterFirst = await videoRepository.findOneByOrFail({
        id: video.id,
      });
      expect(afterFirst.processingStatus).toBe(ProcessingStatus.PROCESSING);

      await processor.onFailed(job(video.id, 3), new Error('no video stream'));

      const afterLast = await videoRepository.findOneByOrFail({ id: video.id });
      expect(afterLast.processingStatus).toBe(ProcessingStatus.FAILED);
      expect(afterLast.failureReason).toBe('no video stream');
    });
  },
);
