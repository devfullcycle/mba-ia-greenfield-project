import { DataSource, Repository } from 'typeorm';
import { Channel } from '../../channels/entities/channel.entity';
import { User } from '../../users/entities/user.entity';
import { Video } from '../../videos/entities/video.entity';
import {
  cleanAllTables,
  createTestDataSource,
} from '../../test/create-test-data-source';
import { RefreshToken } from './refresh-token.entity';
import { VerificationToken } from './verification-token.entity';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];

describe('RefreshToken entity (integration)', () => {
  let dataSource: DataSource;
  let userRepository: Repository<User>;
  let refreshTokenRepository: Repository<RefreshToken>;

  beforeAll(async () => {
    dataSource = createTestDataSource(ALL_ENTITIES);
    await dataSource.initialize();
    userRepository = dataSource.getRepository(User);
    refreshTokenRepository = dataSource.getRepository(RefreshToken);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
  });

  let userCounter = 0;
  async function createUser(): Promise<User> {
    return userRepository.save(
      userRepository.create({
        email: `rt_user_${++userCounter}@example.com`,
        password: 'hashed',
      }),
    );
  }

  function buildToken(
    userId: string,
    overrides: Partial<RefreshToken> = {},
  ): Partial<RefreshToken> {
    return {
      token_hash: 'abc123hash',
      family: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      user_id: userId,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      revoked_at: null,
      ...overrides,
    };
  }

  it('should persist a refresh token linked to a user', async () => {
    const user = await createUser();
    const token = await refreshTokenRepository.save(
      refreshTokenRepository.create(buildToken(user.id)),
    );

    expect(token.id).toBeDefined();
    expect(token.token_hash).toBe('abc123hash');
    expect(token.family).toBe('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');
    expect(token.user_id).toBe(user.id);
    expect(token.created_at).toBeInstanceOf(Date);
  });

  it('should allow revoked_at to be null', async () => {
    const user = await createUser();
    const token = await refreshTokenRepository.save(
      refreshTokenRepository.create(buildToken(user.id, { revoked_at: null })),
    );

    expect(token.revoked_at).toBeNull();
  });

  it('should persist a non-null revoked_at', async () => {
    const user = await createUser();
    const revokedAt = new Date();
    const token = await refreshTokenRepository.save(
      refreshTokenRepository.create(
        buildToken(user.id, { revoked_at: revokedAt }),
      ),
    );

    expect(token.revoked_at).toBeInstanceOf(Date);
  });

  it('should require expires_at', async () => {
    const user = await createUser();
    const token = refreshTokenRepository.create({
      token_hash: 'hash',
      family: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      user_id: user.id,
    });

    await expect(refreshTokenRepository.save(token)).rejects.toThrow();
  });

  it('should find a token by token_hash using the index', async () => {
    const user = await createUser();
    await refreshTokenRepository.save(
      refreshTokenRepository.create(
        buildToken(user.id, { token_hash: 'unique_hash_xyz' }),
      ),
    );

    const found = await refreshTokenRepository.findOneBy({
      token_hash: 'unique_hash_xyz',
    });
    expect(found).not.toBeNull();
    expect(found?.user_id).toBe(user.id);
  });

  it('should store the family uuid for rotation queries', async () => {
    const user = await createUser();
    const familyId = 'b1ffbc99-9c0b-4ef8-bb6d-6bb9bd380a22';

    await refreshTokenRepository.save(
      refreshTokenRepository.create(buildToken(user.id, { family: familyId })),
    );
    await refreshTokenRepository.save(
      refreshTokenRepository.create(
        buildToken(user.id, {
          family: familyId,
          token_hash: 'second_hash',
          revoked_at: new Date(),
        }),
      ),
    );

    const tokens = await refreshTokenRepository.findBy({ family: familyId });
    expect(tokens).toHaveLength(2);
  });

  it('should load the related user via ManyToOne relation', async () => {
    const user = await createUser();
    await refreshTokenRepository.save(
      refreshTokenRepository.create(
        buildToken(user.id, { token_hash: 'rel_hash' }),
      ),
    );

    const found = await refreshTokenRepository.findOne({
      where: { token_hash: 'rel_hash' },
      relations: ['user'],
    });

    expect(found?.user.id).toBe(user.id);
  });
});
