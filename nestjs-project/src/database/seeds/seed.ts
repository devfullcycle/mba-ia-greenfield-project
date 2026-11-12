import { AppDataSource } from '../data-source';
import { DEV_VIDEOS, seedPhase03, seedPublicId } from './phase-03-dev.seed';

async function runSeed(): Promise<void> {
  await AppDataSource.initialize();
  console.log('Database connection initialized');

  await seedPhase03(AppDataSource);
  console.log('Phase 03 dev data seeded:');
  for (const v of DEV_VIDEOS) {
    console.log(`  ${seedPublicId(v.seq)}  ${v.status.padEnd(10)} ${v.title}`);
  }

  await AppDataSource.destroy();
  console.log('Database connection closed');
}

runSeed().catch((error: unknown) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
