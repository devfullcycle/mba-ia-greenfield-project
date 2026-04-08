import 'dotenv/config';
import { DataSource } from 'typeorm';
import databaseConfig from '../config/database.config';

const dbConfig = databaseConfig();

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: dbConfig.host,
  port: dbConfig.port,
  username: dbConfig.username,
  password: dbConfig.password,
  database: dbConfig.name,
  synchronize: false,
  migrations: ['src/database/migrations/*.ts'],
  entities: ['src/**/*.entity.ts'],
});