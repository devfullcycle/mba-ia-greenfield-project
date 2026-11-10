import { DataSource } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { Channel } from '../channels/entities/channel.entity';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { CreateUsersAndChannels1775687773260 } from './migrations/1775687773260-CreateUsersAndChannels';
import { CreateAuthTokens1777579850478 } from './migrations/1777579850478-CreateAuthTokens';
import { CreateVideos1794273602577 } from './migrations/1794273602577-CreateVideos';
import { Video } from '../videos/entities/video.entity';
import { createTestDataSource } from '../test/create-test-data-source';

const MANAGED_TABLES = [
  'users',
  'channels',
  'refresh_tokens',
  'verification_tokens',
  'videos',
];

// Enum types created by the migrations (see 1777579850478-CreateAuthTokens).
const MANAGED_ENUM_TYPES = [
  'verification_tokens_type_enum',
  'videos_status_enum',
];

const VIDEOS_SEQUENCE = 'videos_seq_seq';

describe('Database migrations (integration)', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = createTestDataSource(
      [User, Channel, RefreshToken, VerificationToken, Video],
      {
        synchronize: false,
        migrations: [
          CreateUsersAndChannels1775687773260,
          CreateAuthTokens1777579850478,
          CreateVideos1794273602577,
        ],
      },
    );

    await dataSource.initialize();

    await Promise.all([
      ...MANAGED_TABLES.map((table) =>
        dataSource.query(`DROP TABLE IF EXISTS "${table}" CASCADE`),
      ),
      dataSource.query(`DROP TABLE IF EXISTS "migrations" CASCADE`),
    ]);

    // Enum types outlive DROP TABLE; drop them after the tables so re-running
    // the migrations does not fail with "type ... already exists".
    await Promise.all(
      MANAGED_ENUM_TYPES.map((type) =>
        dataSource.query(`DROP TYPE IF EXISTS "public"."${type}" CASCADE`),
      ),
    );
    await dataSource.query(
      `DROP SEQUENCE IF EXISTS "public"."${VIDEOS_SEQUENCE}"`,
    );
  });

  afterAll(async () => {
    // The second test undoes the last migration, leaving the videos table missing.
    // Re-apply so the shared DB is fully migrated when subsequent suites run.
    await dataSource.runMigrations();
    await dataSource.destroy();
  });

  it('should apply all migrations and create all managed tables', async () => {
    const ranMigrations = await dataSource.runMigrations();

    expect(ranMigrations).toHaveLength(3);

    const result = await dataSource.query<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = ANY($1::text[])
       ORDER BY table_name`,
      [MANAGED_TABLES],
    );
    const tableNames = result.map((r) => r.table_name);
    expect(tableNames).toEqual([
      'channels',
      'refresh_tokens',
      'users',
      'verification_tokens',
      'videos',
    ]);
  });

  it('should create the videos sequence and status enum', async () => {
    expect(await sequenceExists(dataSource)).toBe(true);
    expect(await enumExists(dataSource)).toBe(true);
  });

  it('should revert CreateVideos and remove the videos table, sequence and enum', async () => {
    await dataSource.undoLastMigration();

    const result = await dataSource.query<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'videos'`,
    );
    expect(result).toHaveLength(0);
    expect(await sequenceExists(dataSource)).toBe(false);
    expect(await enumExists(dataSource)).toBe(false);
  });
});

async function sequenceExists(dataSource: DataSource): Promise<boolean> {
  const rows = await dataSource.query<unknown[]>(
    `SELECT 1 FROM pg_class WHERE relkind = 'S' AND relname = $1`,
    [VIDEOS_SEQUENCE],
  );
  return rows.length > 0;
}

async function enumExists(dataSource: DataSource): Promise<boolean> {
  const rows = await dataSource.query<unknown[]>(
    `SELECT 1 FROM pg_type WHERE typname = 'videos_status_enum'`,
  );
  return rows.length > 0;
}
