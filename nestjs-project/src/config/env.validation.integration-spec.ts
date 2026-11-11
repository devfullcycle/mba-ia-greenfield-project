import type { ValidationError } from 'joi';
import { envValidationSchema } from './env.validation';

const requiredEnv = {
  DB_USERNAME: 'user',
  DB_PASSWORD: 'pass',
  DB_NAME: 'db',
  JWT_SECRET: 'secret',
  JWT_REFRESH_SECRET: 'refresh-secret',
  S3_PUBLIC_ENDPOINT: 'http://localhost:9000',
  S3_ACCESS_KEY_ID: 'access-key',
  S3_SECRET_ACCESS_KEY: 'secret-key',
  VIDEO_PUBLIC_ID_ALPHABET: 'abcdefghijklmnopqrstuvwxyz0123456789',
};

interface EnvValidationResult {
  error?: ValidationError;
  value: Record<string, string>;
}

const validate = (env: Record<string, string>): EnvValidationResult =>
  validateRaw({ ...requiredEnv, ...env });

const validateRaw = (env: Record<string, string>): EnvValidationResult =>
  envValidationSchema.validate(env, { allowUnknown: true, abortEarly: false });

const withoutKey = (key: keyof typeof requiredEnv): Record<string, string> => {
  const env: Record<string, string> = { ...requiredEnv };
  delete env[key];
  return env;
};

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

describe('envValidationSchema — storage, queue and video keys', () => {
  it.each([
    'S3_PUBLIC_ENDPOINT',
    'S3_ACCESS_KEY_ID',
    'S3_SECRET_ACCESS_KEY',
    'VIDEO_PUBLIC_ID_ALPHABET',
  ] as const)('should reject a missing %s naming the key', (key) => {
    const { error } = validateRaw(withoutKey(key));
    expect(error).toBeDefined();
    expect(error!.message).toContain(key);
  });

  it('should default storage and queue hosts to the Compose service names', () => {
    const { value, error } = validate({});
    expect(error).toBeUndefined();
    expect(value.S3_ENDPOINT).toBe('http://minio:9000');
    expect(value.REDIS_HOST).toBe('redis');
    expect(value.REDIS_PORT).toBe(6379);
  });

  it('should reject a VIDEO_PUBLIC_ID_ALPHABET shorter than 16 characters', () => {
    const { error } = validate({ VIDEO_PUBLIC_ID_ALPHABET: 'abcdefghijklmno' });
    expect(error).toBeDefined();
    expect(error!.message).toContain('VIDEO_PUBLIC_ID_ALPHABET');
  });

  it('should reject a VIDEO_PUBLIC_ID_ALPHABET with repeated characters', () => {
    const { error } = validate({
      VIDEO_PUBLIC_ID_ALPHABET: 'aabcdefghijklmnopqrs',
    });
    expect(error).toBeDefined();
    expect(error!.message).toContain('VIDEO_PUBLIC_ID_ALPHABET');
  });

  it('should reject a VIDEO_RECONCILER_ENABLED value other than true/false', () => {
    const { error } = validate({ VIDEO_RECONCILER_ENABLED: 'yes' });
    expect(error).toBeDefined();
    expect(error!.message).toContain('VIDEO_RECONCILER_ENABLED');
  });
});

describe('Jest test environment isolation', () => {
  it('should point storage and queue at the test bucket/prefix despite .env', () => {
    expect(process.env.S3_BUCKET).toBe('streamtube-test');
    expect(process.env.QUEUE_PREFIX).toBe('streamtube-test');
  });
});
