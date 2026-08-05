import { DataSource, Repository } from 'typeorm';
import { Channel } from '../../channels/entities/channel.entity';
import { User } from '../../users/entities/user.entity';
import { Video } from '../../videos/entities/video.entity';
import {
  cleanAllTables,
  createTestDataSource,
} from '../../test/create-test-data-source';
import { RefreshToken } from './refresh-token.entity';
import {
  VerificationToken,
  VerificationTokenType,
} from './verification-token.entity';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];

describe('VerificationToken entity (integration)', () => {
  let dataSource: DataSource;
  let userRepository: Repository<User>;
  let verificationTokenRepository: Repository<VerificationToken>;

  beforeAll(async () => {
    dataSource = createTestDataSource(ALL_ENTITIES);
    await dataSource.initialize();
    userRepository = dataSource.getRepository(User);
    verificationTokenRepository = dataSource.getRepository(VerificationToken);
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
        email: `vt_user_${++userCounter}@example.com`,
        password: 'hashed',
      }),
    );
  }

  function buildToken(
    userId: string,
    overrides: Partial<VerificationToken> = {},
  ): Partial<VerificationToken> {
    return {
      token_hash: 'hashvalue',
      type: VerificationTokenType.EMAIL_CONFIRMATION,
      user_id: userId,
      expires_at: new Date(Date.now() + 60 * 60 * 1000),
      used_at: null,
      ...overrides,
    };
  }

  it('should persist a verification token of type email_confirmation', async () => {
    const user = await createUser();
    const token = await verificationTokenRepository.save(
      verificationTokenRepository.create(buildToken(user.id)),
    );

    expect(token.id).toBeDefined();
    expect(token.type).toBe(VerificationTokenType.EMAIL_CONFIRMATION);
    expect(token.user_id).toBe(user.id);
    expect(token.created_at).toBeInstanceOf(Date);
  });

  it('should persist a verification token of type password_reset', async () => {
    const user = await createUser();
    const token = await verificationTokenRepository.save(
      verificationTokenRepository.create(
        buildToken(user.id, { type: VerificationTokenType.PASSWORD_RESET }),
      ),
    );

    expect(token.type).toBe(VerificationTokenType.PASSWORD_RESET);
  });

  it('should reject an invalid enum value for type', async () => {
    const user = await createUser();
    const token = verificationTokenRepository.create({
      token_hash: 'hash',
      type: 'invalid_type' as VerificationTokenType,
      user_id: user.id,
      expires_at: new Date(Date.now() + 3600 * 1000),
    });

    await expect(verificationTokenRepository.save(token)).rejects.toThrow();
  });

  it('should allow used_at to be null', async () => {
    const user = await createUser();
    const token = await verificationTokenRepository.save(
      verificationTokenRepository.create(
        buildToken(user.id, { used_at: null }),
      ),
    );

    expect(token.used_at).toBeNull();
  });

  it('should persist a non-null used_at', async () => {
    const user = await createUser();
    const usedAt = new Date();
    const token = await verificationTokenRepository.save(
      verificationTokenRepository.create(
        buildToken(user.id, { used_at: usedAt }),
      ),
    );

    expect(token.used_at).toBeInstanceOf(Date);
  });

  it('should require expires_at', async () => {
    const user = await createUser();
    const token = verificationTokenRepository.create({
      token_hash: 'hash',
      type: VerificationTokenType.EMAIL_CONFIRMATION,
      user_id: user.id,
    });

    await expect(verificationTokenRepository.save(token)).rejects.toThrow();
  });

  it('should find a token by token_hash using the index', async () => {
    const user = await createUser();
    await verificationTokenRepository.save(
      verificationTokenRepository.create(
        buildToken(user.id, { token_hash: 'unique_token_hash' }),
      ),
    );

    const found = await verificationTokenRepository.findOneBy({
      token_hash: 'unique_token_hash',
    });
    expect(found).not.toBeNull();
    expect(found?.user_id).toBe(user.id);
  });

  it('should load the related user via ManyToOne relation', async () => {
    const user = await createUser();
    await verificationTokenRepository.save(
      verificationTokenRepository.create(
        buildToken(user.id, { token_hash: 'rel_hash' }),
      ),
    );

    const found = await verificationTokenRepository.findOne({
      where: { token_hash: 'rel_hash' },
      relations: ['user'],
    });

    expect(found?.user.id).toBe(user.id);
  });
});
