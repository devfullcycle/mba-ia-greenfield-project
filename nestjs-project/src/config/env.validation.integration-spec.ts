import { envValidationSchema } from './env.validation';

const requiredEnv = {
  DB_USERNAME: 'user',
  DB_PASSWORD: 'pass',
  DB_NAME: 'db',
  JWT_SECRET: 'secret',
  JWT_REFRESH_SECRET: 'refresh-secret',
  STORAGE_ENDPOINT: 'http://storage:8333',
  STORAGE_PUBLIC_ENDPOINT: 'http://localhost:8333',
  STORAGE_BUCKET: 'bucket',
  STORAGE_ACCESS_KEY: 'access',
  STORAGE_SECRET_KEY: 'secret',
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
    const result = validate({});
    const value = result.value as { SWAGGER_ENABLED: string };
    expect(result.error).toBeUndefined();
    expect(value.SWAGGER_ENABLED).toBe('false');
  });
});

describe('envValidationSchema — storage', () => {
  const storageKeys = [
    'STORAGE_ENDPOINT',
    'STORAGE_PUBLIC_ENDPOINT',
    'STORAGE_BUCKET',
    'STORAGE_ACCESS_KEY',
    'STORAGE_SECRET_KEY',
  ];

  it.each(storageKeys)('should reject a missing %s naming the field', (key) => {
    const env = { ...requiredEnv } as Record<string, string | undefined>;
    delete env[key];
    const { error } = envValidationSchema.validate(env, {
      allowUnknown: true,
      abortEarly: false,
    });
    expect(error).toBeDefined();
    expect(error!.message).toContain(key);
  });

  it('should accept valid storage variables and apply defaults', () => {
    const { value, error } = validate({}) as {
      value: Record<string, string>;
      error?: Error;
    };
    expect(error).toBeUndefined();
    expect(value.STORAGE_REGION).toBe('us-east-1');
    expect(value.STORAGE_FORCE_PATH_STYLE).toBe('true');
  });

  it.each(['STORAGE_ENDPOINT', 'STORAGE_PUBLIC_ENDPOINT'])(
    'should reject %s that is not a URI naming the field',
    (key) => {
      const { error } = validate({ [key]: 'not a url' });
      expect(error).toBeDefined();
      expect(error!.message).toContain(key);
    },
  );

  it('should reject an invalid STORAGE_FORCE_PATH_STYLE', () => {
    const { error } = validate({ STORAGE_FORCE_PATH_STYLE: 'maybe' });
    expect(error).toBeDefined();
    expect(error!.message).toContain('STORAGE_FORCE_PATH_STYLE');
  });
});
