import { envValidationSchema } from './env.validation';

const requiredEnv = {
  DB_USERNAME: 'user',
  DB_PASSWORD: 'pass',
  DB_NAME: 'db',
  JWT_SECRET: 'secret',
  JWT_REFRESH_SECRET: 'refresh-secret',
  STORAGE_ACCESS_KEY: 'access-key',
  STORAGE_SECRET_KEY: 'secret-key',
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

describe('envValidationSchema — storage', () => {
  const validateRaw = (env: Record<string, string | undefined>) =>
    envValidationSchema.validate(env, {
      allowUnknown: true,
      abortEarly: false,
    });

  it('should reject when STORAGE_ACCESS_KEY is missing', () => {
    const { STORAGE_ACCESS_KEY: _omitted, ...rest } = requiredEnv;
    const { error } = validateRaw(rest);
    expect(error).toBeDefined();
    expect(error!.message).toContain('STORAGE_ACCESS_KEY');
  });

  it('should reject when STORAGE_SECRET_KEY is missing', () => {
    const { STORAGE_SECRET_KEY: _omitted, ...rest } = requiredEnv;
    const { error } = validateRaw(rest);
    expect(error).toBeDefined();
    expect(error!.message).toContain('STORAGE_SECRET_KEY');
  });

  it('should apply storage and redis defaults when omitted', () => {
    const { value, error } = validate({});
    expect(error).toBeUndefined();
    expect(value.STORAGE_ENDPOINT).toBe('http://minio:9000');
    expect(value.STORAGE_BUCKET).toBe('streamtube-videos');
    expect(value.STORAGE_FORCE_PATH_STYLE).toBe('true');
    expect(value.STORAGE_PRESIGN_EXPIRATION).toBe(3600);
    expect(value.UPLOAD_PART_SIZE).toBe(10485760);
    expect(value.UPLOAD_MAX_SIZE).toBe(10737418240);
    expect(value.REDIS_HOST).toBe('redis');
    expect(value.REDIS_PORT).toBe(6379);
  });
});
