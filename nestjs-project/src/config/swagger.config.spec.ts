import { ConfigModule, type ConfigType } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import swaggerConfig from './swagger.config';

const loadConfig = async (
  swaggerEnabled?: string,
): Promise<ConfigType<typeof swaggerConfig>> => {
  if (swaggerEnabled !== undefined) {
    process.env.SWAGGER_ENABLED = swaggerEnabled;
  } else {
    delete process.env.SWAGGER_ENABLED;
  }

  const module = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ ignoreEnvFile: true, load: [swaggerConfig] }),
    ],
  }).compile();

  const config = module.get<ConfigType<typeof swaggerConfig>>(
    swaggerConfig.KEY,
  );
  await module.close();
  return config;
};

describe('swaggerConfig', () => {
  afterEach(() => {
    delete process.env.SWAGGER_ENABLED;
  });

  it('should return enabled: true when SWAGGER_ENABLED=true', async () => {
    const config = await loadConfig('true');
    expect(config.enabled).toBe(true);
  });

  it('should return enabled: false when SWAGGER_ENABLED=false', async () => {
    const config = await loadConfig('false');
    expect(config.enabled).toBe(false);
  });

  it('should return enabled: false when SWAGGER_ENABLED is not set', async () => {
    const config = await loadConfig();
    expect(config.enabled).toBe(false);
  });
});
