import type * as Joi from 'joi';
import { envValidationSchema } from './env.validation';

const requiredEnv = {
  DB_USERNAME: 'user',
  DB_PASSWORD: 'pass',
  DB_NAME: 'db',
  JWT_SECRET: 'secret',
  JWT_REFRESH_SECRET: 'refresh-secret',
  S3_ENDPOINT: 'http://seaweedfs:8333',
  S3_PUBLIC_ENDPOINT: 'http://localhost:8333',
  S3_ACCESS_KEY_ID: 'key',
  S3_SECRET_ACCESS_KEY: 'secret',
};

const validate = (env: Record<string, string>) =>
  envValidationSchema.validate(
    { ...requiredEnv, ...env },
    { allowUnknown: true, abortEarly: false },
  ) as { value: Record<string, string>; error?: Joi.ValidationError };

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

describe('envValidationSchema — storage and queue', () => {
  it('should reject a missing S3_ENDPOINT', () => {
    const { error } = envValidationSchema.validate(
      { ...requiredEnv, S3_ENDPOINT: undefined },
      { allowUnknown: true, abortEarly: false },
    );
    expect(error).toBeDefined();
    expect(error!.message).toContain('S3_ENDPOINT');
  });

  it('should reject a missing S3_PUBLIC_ENDPOINT', () => {
    const { error } = envValidationSchema.validate(
      { ...requiredEnv, S3_PUBLIC_ENDPOINT: undefined },
      { allowUnknown: true, abortEarly: false },
    );
    expect(error).toBeDefined();
    expect(error!.message).toContain('S3_PUBLIC_ENDPOINT');
  });

  it('should apply storage defaults for part size and max size', () => {
    const { value, error } = validate({});
    expect(error).toBeUndefined();
    expect(Number(value.S3_PART_SIZE_BYTES)).toBe(64 * 1024 * 1024);
    expect(Number(value.S3_MAX_SIZE_BYTES)).toBe(10 * 1024 * 1024 * 1024);
  });

  it('should reject a part size below the S3 minimum of 5 MiB', () => {
    const { error } = validate({ S3_PART_SIZE_BYTES: '1024' });
    expect(error).toBeDefined();
    expect(error!.message).toContain('S3_PART_SIZE_BYTES');
  });

  it('should default QUEUE_HOST to the redis Compose service name', () => {
    const { value, error } = validate({});
    expect(error).toBeUndefined();
    expect(value.QUEUE_HOST).toBe('redis');
  });
});
