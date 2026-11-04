import storageConfig, {
  DEFAULT_PART_SIZE_BYTES,
  TEN_GIGABYTES_IN_BYTES,
} from './storage.config';

describe('storageConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('returns default S3 and upload configuration when env vars are not set', () => {
    delete process.env.S3_ENDPOINT;
    delete process.env.S3_REGION;
    delete process.env.S3_ACCESS_KEY;
    delete process.env.S3_SECRET_KEY;
    delete process.env.S3_BUCKET;
    delete process.env.S3_PRESIGNED_URL_EXPIRATION_SECONDS;
    delete process.env.UPLOAD_PART_SIZE_BYTES;
    delete process.env.MAX_UPLOAD_SIZE_BYTES;

    const cfg = storageConfig();
    expect(cfg).toEqual({
      endpoint: 'http://minio:9000',
      region: 'us-east-1',
      accessKey: 'minioadmin',
      secretKey: 'minioadmin',
      bucket: 'streamtube-videos',
      presignedUrlExpirationSeconds: 3600,
      partSizeBytes: DEFAULT_PART_SIZE_BYTES,
      maxUploadSizeBytes: TEN_GIGABYTES_IN_BYTES,
    });
  });

  it('reads custom S3 and upload configuration from environment variables', () => {
    process.env.S3_ENDPOINT = 'http://s3.internal:9000';
    process.env.S3_REGION = 'sa-east-1';
    process.env.S3_ACCESS_KEY = 'custom-key';
    process.env.S3_SECRET_KEY = 'custom-secret';
    process.env.S3_BUCKET = 'custom-bucket';
    process.env.S3_PRESIGNED_URL_EXPIRATION_SECONDS = '1800';
    process.env.UPLOAD_PART_SIZE_BYTES = '20971520';
    process.env.MAX_UPLOAD_SIZE_BYTES = '5368709120';

    const cfg = storageConfig();
    expect(cfg).toEqual({
      endpoint: 'http://s3.internal:9000',
      region: 'sa-east-1',
      accessKey: 'custom-key',
      secretKey: 'custom-secret',
      bucket: 'custom-bucket',
      presignedUrlExpirationSeconds: 1800,
      partSizeBytes: 20971520,
      maxUploadSizeBytes: 5368709120,
    });
  });
});
