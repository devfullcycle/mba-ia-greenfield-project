import type { ValidationError } from 'joi';
import { envValidationSchema } from './env.validation';

const requiredEnv = {
  DB_USERNAME: 'user',
  DB_PASSWORD: 'pass',
  DB_NAME: 'db',
  JWT_SECRET: 'secret',
  JWT_REFRESH_SECRET: 'refresh-secret',
};

const validate = (
  env: Record<string, string>,
): { value: Record<string, unknown>; error?: ValidationError } =>
  envValidationSchema.validate(
    { ...requiredEnv, ...env },
    { allowUnknown: true, abortEarly: false },
  );

describe('envValidationSchema — Phase 03 storage & queue', () => {
  it('applies defaults for S3 and Redis variables when not explicitly set', () => {
    const { value, error } = validate({});
    expect(error).toBeUndefined();
    expect(value.S3_ENDPOINT).toBe('http://minio:9000');
    expect(value.S3_BUCKET).toBe('streamtube-videos');
    expect(value.REDIS_HOST).toBe('redis');
    expect(value.REDIS_PORT).toBe(6379);
    expect(value.MAX_UPLOAD_SIZE_BYTES).toBe(10737418240);
  });

  it('rejects an invalid S3_ENDPOINT URI', () => {
    const { error } = validate({ S3_ENDPOINT: 'not-a-uri' });
    expect(error).toBeDefined();
    expect(error!.message).toContain('S3_ENDPOINT');
  });

  it('rejects empty S3_ACCESS_KEY or S3_SECRET_KEY', () => {
    const { error } = validate({ S3_ACCESS_KEY: '', S3_SECRET_KEY: '' });
    expect(error).toBeDefined();
    expect(error!.message).toContain('S3_ACCESS_KEY');
    expect(error!.message).toContain('S3_SECRET_KEY');
  });

  it('rejects invalid REDIS_PORT', () => {
    const { error } = validate({ REDIS_PORT: '99999' });
    expect(error).toBeDefined();
    expect(error!.message).toContain('REDIS_PORT');
  });
});
