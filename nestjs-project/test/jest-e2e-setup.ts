import 'dotenv/config';
process.env.DB_HOST = process.env.DB_HOST || 'localhost';
process.env.REDIS_HOST = process.env.REDIS_HOST || 'localhost';
process.env.MAIL_HOST = process.env.MAIL_HOST || 'localhost';
process.env.STORAGE_ENDPOINT =
  process.env.STORAGE_ENDPOINT || 'http://localhost:9000';
