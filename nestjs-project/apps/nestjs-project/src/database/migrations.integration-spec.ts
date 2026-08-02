import { DataSource } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { Channel } from '../channels/entities/channel.entity';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { CreateUsersAndChannels1775687773260 } from './migrations/1775687773260-CreateUsersAndChannels';
import { CreateAuthTokens1777579850478 } from './migrations/1777579850478-CreateAuthTokens';
import { CreateVideos1785621122372 } from './migrations/1785621122372-CreateVideos';
import { createTestDataSource } from '../test/create-test-data-source';
import { Video } from '../videos/entities/video.entity';

const MANAGED_TABLES = [
  'users',
  'channels',
  'refresh_tokens',
  'verification_tokens',
  'videos',
];

const VERIFICATION_TOKENS_TYPE_ENUM = 'verification_tokens_type_enum';
const VIDEOS_STATUS_ENUM = 'videos_status_enum';

async function getEnumValues(
  dataSource: DataSource,
  enumName: string,
): Promise<string[]> {
  const rows = await dataSource.query<{ enumlabel: string }[]>(
    `SELECT e.enumlabel
     FROM pg_type t
     JOIN pg_enum e ON t.oid = e.enumtypid
     JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
     WHERE t.typname = $1 AND n.nspname = 'public'
     ORDER BY e.enumsortorder`,
    [enumName],
  );
  return rows.map((r) => r.enumlabel);
}

async function enumTypeExists(
  dataSource: DataSource,
  enumName: string,
): Promise<boolean> {
  const rows = await dataSource.query<{ typname: string }[]>(
    `SELECT t.typname
     FROM pg_type t
     JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
     WHERE t.typname = $1 AND n.nspname = 'public'`,
    [enumName],
  );
  return rows.length > 0;
}

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
          CreateVideos1785621122372,
        ],
      },
    );

    await dataSource.initialize();

    // Ensures the migrations run against a completely empty PostgreSQL
    // database — tables, tracking table, and leftover enum types alike.
    // Dropped sequentially (not Promise.all): concurrent DROP TABLE ...
    // CASCADE statements across FK-related tables (channels -> videos,
    // users -> channels/refresh_tokens/verification_tokens) can acquire
    // ACCESS EXCLUSIVE locks in different orders and deadlock in Postgres.
    for (const table of MANAGED_TABLES) {
      await dataSource.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
    }
    await dataSource.query(`DROP TABLE IF EXISTS "migrations" CASCADE`);
    await dataSource.query(
      `DROP TYPE IF EXISTS "public"."${VERIFICATION_TOKENS_TYPE_ENUM}"`,
    );
    await dataSource.query(
      `DROP TYPE IF EXISTS "public"."${VIDEOS_STATUS_ENUM}"`,
    );
  });

  afterAll(async () => {
    // Earlier tests undo migrations, leaving token tables/types missing.
    // Re-apply so the shared DB is fully migrated when subsequent suites run.
    await dataSource.runMigrations();
    await dataSource.destroy();
  });

  it('should apply all migrations on an empty database and create all five tables', async () => {
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

  it('should create the videos_status_enum with the expected values', async () => {
    const exists = await enumTypeExists(dataSource, VIDEOS_STATUS_ENUM);
    expect(exists).toBe(true);

    const values = await getEnumValues(dataSource, VIDEOS_STATUS_ENUM);
    expect(values).toEqual(['draft', 'processing', 'ready', 'failed']);
  });

  it('should create the verification_tokens_type_enum with the expected values', async () => {
    const exists = await enumTypeExists(
      dataSource,
      VERIFICATION_TOKENS_TYPE_ENUM,
    );
    expect(exists).toBe(true);

    const values = await getEnumValues(
      dataSource,
      VERIFICATION_TOKENS_TYPE_ENUM,
    );
    expect(values).toEqual(['email_confirmation', 'password_reset']);
  });

  it('should use the enum type for the verification_tokens.type column', async () => {
    const result = await dataSource.query<{ udt_name: string }[]>(
      `SELECT udt_name FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'verification_tokens'
         AND column_name = 'type'`,
    );
    expect(result).toHaveLength(1);
    expect(result[0].udt_name).toBe(VERIFICATION_TOKENS_TYPE_ENUM);
  });

  it('should revert the last migration and remove the videos table and enum type', async () => {
    await dataSource.undoLastMigration();

    const result = await dataSource.query<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = 'videos'`,
    );
    expect(result).toHaveLength(0);

    const enumExists = await enumTypeExists(dataSource, VIDEOS_STATUS_ENUM);
    expect(enumExists).toBe(false);
  });

  it('should revert the previous migration and remove token tables and the enum type', async () => {
    await dataSource.undoLastMigration();

    const result = await dataSource.query<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = ANY($1::text[])`,
      [['refresh_tokens', 'verification_tokens']],
    );
    expect(result).toHaveLength(0);

    const enumExists = await enumTypeExists(
      dataSource,
      VERIFICATION_TOKENS_TYPE_ENUM,
    );
    expect(enumExists).toBe(false);
  });

  it('should re-apply both migrations successfully after a full revert', async () => {
    const ranMigrations = await dataSource.runMigrations();

    expect(ranMigrations).toHaveLength(2);
    expect(ranMigrations.map((m) => m.name)).toEqual([
      'CreateAuthTokens1777579850478',
      'CreateVideos1785621122372',
    ]);

    const result = await dataSource.query<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = ANY($1::text[])
       ORDER BY table_name`,
      [['refresh_tokens', 'verification_tokens', 'videos']],
    );
    expect(result.map((r) => r.table_name)).toEqual([
      'refresh_tokens',
      'verification_tokens',
      'videos',
    ]);

    const tokensEnumExists = await enumTypeExists(
      dataSource,
      VERIFICATION_TOKENS_TYPE_ENUM,
    );
    expect(tokensEnumExists).toBe(true);

    const videosEnumExists = await enumTypeExists(
      dataSource,
      VIDEOS_STATUS_ENUM,
    );
    expect(videosEnumExists).toBe(true);
  });
});
