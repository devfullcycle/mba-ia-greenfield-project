import { envValidationSchema } from './env.validation';

const requiredEnv = {
  DB_USERNAME: 'user',
  DB_PASSWORD: 'pass',
  DB_NAME: 'db',
  JWT_SECRET: 'secret',
  JWT_REFRESH_SECRET: 'refresh-secret',
};

const validate = (env: Record<string, string>) =>
  envValidationSchema.validate(
    { ...requiredEnv, ...env },
    { allowUnknown: true, abortEarly: false },
  );

describe('envValidationSchema — SWAGGER_ENABLED', () => {
  it('should reject SWAGGER_ENABLED with an invalid value', () => {
    const { error } = validate({ SWAGGER_ENABLED: 'invalid' });
    expect(error).toBeDefined();
    expect(error!.message).toContain('SWAGGER_ENABLED');
  });

  it('should accept SWAGGER_ENABLED=true', () => {
    const { error } = validate({ SWAGGER_ENABLED: 'true' });
    expect(error).toBeUndefined();
  });

  it('should accept SWAGGER_ENABLED=false', () => {
    const { error } = validate({ SWAGGER_ENABLED: 'false' });
    expect(error).toBeUndefined();
  });

  it('should apply default false when SWAGGER_ENABLED is not set', () => {
    const { value, error } = validate({});
    expect(error).toBeUndefined();
    expect(value.SWAGGER_ENABLED).toBe('false');
  });
});

describe('envValidationSchema — Storage and Redis', () => {
  it('should apply default storage values when not set', () => {
    const { value, error } = validate({});
    expect(error).toBeUndefined();
    expect(value.STORAGE_ENDPOINT).toBe('http://storage:9000');
    expect(value.STORAGE_REGION).toBe('us-east-1');
    expect(value.STORAGE_ACCESS_KEY).toBe('minioadmin');
    expect(value.STORAGE_SECRET_KEY).toBe('minioadmin');
    expect(value.STORAGE_BUCKET_VIDEOS).toBe('videos');
    expect(value.STORAGE_BUCKET_THUMBNAILS).toBe('thumbnails');
    expect(value.STORAGE_FORCE_PATH_STYLE).toBe('true');
  });

  it('should apply default redis values when not set', () => {
    const { value, error } = validate({});
    expect(error).toBeUndefined();
    expect(value.REDIS_HOST).toBe('redis');
    expect(value.REDIS_PORT).toBe(6379);
  });

  it('should reject an invalid STORAGE_ENDPOINT', () => {
    const { error } = validate({ STORAGE_ENDPOINT: 'not-a-url' });
    expect(error).toBeDefined();
    expect(error!.message).toContain('STORAGE_ENDPOINT');
  });

  it('should reject an invalid STORAGE_FORCE_PATH_STYLE', () => {
    const { error } = validate({ STORAGE_FORCE_PATH_STYLE: 'invalid' });
    expect(error).toBeDefined();
    expect(error!.message).toContain('STORAGE_FORCE_PATH_STYLE');
  });

  it('should reject an invalid REDIS_PORT', () => {
    const { error } = validate({ REDIS_PORT: 'not-a-port' });
    expect(error).toBeDefined();
    expect(error!.message).toContain('REDIS_PORT');
  });

  it('should accept custom storage and redis values', () => {
    const { value, error } = validate({
      STORAGE_ENDPOINT: 'http://minio.local:9000',
      STORAGE_REGION: 'eu-west-1',
      STORAGE_ACCESS_KEY: 'custom-key',
      STORAGE_SECRET_KEY: 'custom-secret',
      STORAGE_BUCKET_VIDEOS: 'custom-videos',
      STORAGE_BUCKET_THUMBNAILS: 'custom-thumbnails',
      STORAGE_FORCE_PATH_STYLE: 'false',
      REDIS_HOST: 'custom-redis',
      REDIS_PORT: '6380',
    });
    expect(error).toBeUndefined();
    expect(value.STORAGE_ENDPOINT).toBe('http://minio.local:9000');
    expect(value.STORAGE_REGION).toBe('eu-west-1');
    expect(value.STORAGE_ACCESS_KEY).toBe('custom-key');
    expect(value.STORAGE_SECRET_KEY).toBe('custom-secret');
    expect(value.STORAGE_BUCKET_VIDEOS).toBe('custom-videos');
    expect(value.STORAGE_BUCKET_THUMBNAILS).toBe('custom-thumbnails');
    expect(value.STORAGE_FORCE_PATH_STYLE).toBe('false');
    expect(value.REDIS_HOST).toBe('custom-redis');
    expect(value.REDIS_PORT).toBe(6380);
  });
});
