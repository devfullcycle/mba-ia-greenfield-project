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
  // Queue (Redis / BullMQ) — phase 03
  REDIS_HOST: Joi.string().default('redis'),
  REDIS_PORT: Joi.number().default(6379),
  // Object storage (MinIO / S3) — phase 03
  S3_ENDPOINT: Joi.string().uri().default('http://minio:9000'),
  S3_REGION: Joi.string().default('us-east-1'),
  S3_ACCESS_KEY: Joi.string().default('streamtube'),
  S3_SECRET_KEY: Joi.string().default('streamtube123'),
  S3_BUCKET: Joi.string().default('streamtube-videos'),
  S3_FORCE_PATH_STYLE: Joi.string().valid('true', 'false').default('true'),
  S3_PRESIGN_EXPIRATION: Joi.number().default(3600),
  // Video processing — phase 03
  VIDEO_MAX_SIZE_BYTES: Joi.number().default(10737418240),
  VIDEO_UPLOAD_PART_SIZE_BYTES: Joi.number().default(104857600),
  VIDEO_THUMBNAIL_TIMESTAMP_SECONDS: Joi.number().default(1),
  VIDEO_PROCESSING_CONCURRENCY: Joi.number().default(2),
  VIDEO_PROCESSING_ATTEMPTS: Joi.number().default(5),
});
