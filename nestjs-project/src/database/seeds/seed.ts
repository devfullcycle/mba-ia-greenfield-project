import { AppDataSource } from '../data-source';

async function runSeed(): Promise<void> {
  await AppDataSource.initialize();
  console.log('Database connection initialized');

  await AppDataSource.destroy();
  console.log('Database connection closed');
}

runSeed().catch((error: unknown) => {
  console.error('Seed failed:', error);
  process.exit(1);
});