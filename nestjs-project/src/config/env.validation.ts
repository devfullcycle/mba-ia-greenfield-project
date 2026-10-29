import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().port().default(3000),
  DB_HOST: Joi.string().default('localhost'),
  DB_PORT: Joi.number().default(5432),
  DB_USERNAME: Joi.string().required(),
  DB_PASSWORD: Joi.string().required(),
  DB_NAME: Joi.string().required(),
  JWT_SECRET: Joi.string().required(),
  JWT_REFRESH_SECRET: Joi.string().required(),
  JWT_ACCESS_EXPIRATION: Joi.string().default('15m'),
  JWT_REFRESH_EXPIRATION: Joi.string().default('7d'),
  CONFIRMATION_TOKEN_EXPIRATION_HOURS: Joi.number().default(1),
  PASSWORD_RESET_TOKEN_EXPIRATION_HOURS: Joi.number().default(1),
  APP_URL: Joi.string().uri().default('http://localhost:3000'),
  MAIL_HOST: Joi.string().default('mailpit'),
  MAIL_PORT: Joi.number().default(1025),
  MAIL_FROM: Joi.string().default('"StreamTube" <noreply@streamtube.com>'),
  SWAGGER_ENABLED: Joi.string().valid('true', 'false').default('false'),
  S3_ENDPOINT: Joi.string().uri().required(),
  S3_PUBLIC_ENDPOINT: Joi.string().uri().required(),
  S3_BUCKET: Joi.string().default('streamtube'),
  S3_REGION: Joi.string().default('us-east-1'),
  S3_ACCESS_KEY_ID: Joi.string().required(),
  S3_SECRET_ACCESS_KEY: Joi.string().required(),
  S3_PRESIGN_UPLOAD_TTL_SECONDS: Joi.number().integer().min(60).default(3600),
  S3_PRESIGN_READ_TTL_SECONDS: Joi.number().integer().min(60).default(14400),
  S3_PART_SIZE_BYTES: Joi.number()
    .integer()
    .min(5 * 1024 * 1024)
    .default(64 * 1024 * 1024),
  S3_MAX_SIZE_BYTES: Joi.number()
    .integer()
    .min(1)
    .default(10 * 1024 * 1024 * 1024),
  QUEUE_HOST: Joi.string().default('redis'),
  QUEUE_PORT: Joi.number().port().default(6379),
});
