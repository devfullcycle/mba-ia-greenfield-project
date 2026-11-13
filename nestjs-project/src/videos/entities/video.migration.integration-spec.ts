import { DataSource } from 'typeorm';
import { Channel } from '../../channels/entities/channel.entity';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';
import { VerificationToken } from '../../auth/entities/verification-token.entity';
import { User } from '../../users/entities/user.entity';
import { createTestDataSource } from '../../test/create-test-data-source';
import { CreateUsersAndChannels1775687773260 } from '../../database/migrations/1775687773260-CreateUsersAndChannels';
import { CreateAuthTokens1777579850478 } from '../../database/migrations/1777579850478-CreateAuthTokens';
import { CreateVideos1794574108904 } from '../../database/migrations/1794574108904-CreateVideos';

const MANAGED_TABLES = [
  'videos',
  'users',
  'channels',
  'refresh_tokens',
  'verification_tokens',
];

describe('Video migration (integration)', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = createTestDataSource(
      [User, Channel, RefreshToken, VerificationToken],
      {
        synchronize: false,
        migrations: [
          CreateUsersAndChannels1775687773260,
          CreateAuthTokens1777579850478,
          CreateVideos1794574108904,
        ],
      },
    );

    await dataSource.initialize();
    for (const table of MANAGED_TABLES) {
      await dataSource.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
    }
    await dataSource.query(`DROP TYPE IF EXISTS "videos_status_enum" CASCADE`);
    await dataSource.query(`DROP TABLE IF EXISTS "migrations" CASCADE`);
  });

  afterAll(async () => {
    await dataSource.runMigrations();
    await dataSource.destroy();
  });

  it('creates the videos table and status enum', async () => {
    const migrations = await dataSource.runMigrations();
    expect(migrations).toHaveLength(3);

    const table = await dataSource.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'videos'`,
    );
    const enumValues = await dataSource.query(
      `SELECT e.enumlabel FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'videos_status_enum' ORDER BY e.enumsortorder`,
    );

    expect(table).toHaveLength(1);
    expect(
      enumValues.map((row: { enumlabel: string }) => row.enumlabel),
    ).toEqual([
      'DRAFT',
      'UPLOADING',
      'UPLOADED',
      'PROCESSING',
      'READY',
      'ERROR',
      'CANCELLED',
    ]);
  });

  it('reverts the video migration without removing phase 02 tables', async () => {
    await dataSource.undoLastMigration();

    const videos = await dataSource.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'videos'`,
    );
    const users = await dataSource.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users'`,
    );

    expect(videos).toHaveLength(0);
    expect(users).toHaveLength(1);
  });
});
