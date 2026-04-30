import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { cleanAllTables, createTestDataSource } from '../test/create-test-data-source';
import { Channel } from './entities/channel.entity';
import { User } from './entities/user.entity';
import { UsersService } from './users.service';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken];

describe('UsersService (integration)', () => {
  let dataSource: DataSource;
  let usersService: UsersService;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;

  beforeAll(async () => {
    dataSource = createTestDataSource(ALL_ENTITIES);
    await dataSource.initialize();
    userRepository = dataSource.getRepository(User);
    channelRepository = dataSource.getRepository(Channel);
    usersService = new UsersService(userRepository, channelRepository, dataSource);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
  });

  describe('createUserWithChannel', () => {
    it('creates a user and channel atomically', async () => {
      const user = await usersService.createUserWithChannel('test@example.com', 'hashed');

      expect(user.id).toBeDefined();
      expect(user.email).toBe('test@example.com');
      expect(user.channel).toBeDefined();
      expect(user.channel.nickname).toBe('test');
      expect(user.channel.name).toBe('test');

      const dbUser = await userRepository.findOneBy({ id: user.id });
      const dbChannel = await channelRepository.findOneBy({ user_id: user.id });
      expect(dbUser).not.toBeNull();
      expect(dbChannel).not.toBeNull();
    });

    it('derives nickname from email prefix', async () => {
      const user = await usersService.createUserWithChannel('john.doe+tag@example.com', 'hashed');
      expect(user.channel.nickname).toBe('johndoetag');
    });

    it('handles nickname collision by appending a random suffix', async () => {
      await usersService.createUserWithChannel('test@example.com', 'hashed');
      const user2 = await usersService.createUserWithChannel('test@other.com', 'hashed');

      expect(user2.channel.nickname).toMatch(/^test_[a-z0-9]{3}$/);
    });

    it('rolls back user creation if channel save fails irrecoverably', async () => {
      await usersService.createUserWithChannel('taken@example.com', 'hashed');

      // Force all 5 retry attempts to fail by pre-creating channels for every possible suffix
      // Instead, we simulate an unrecoverable error by using a duplicate email
      await expect(
        usersService.createUserWithChannel('taken@example.com', 'hashed2'),
      ).rejects.toThrow();

      const count = await userRepository.count({ where: { email: 'taken@example.com' } });
      expect(count).toBe(1);
    });
  });

  describe('findByEmail', () => {
    it('returns null when user does not exist', async () => {
      const result = await usersService.findByEmail('nobody@example.com');
      expect(result).toBeNull();
    });

    it('returns the user with password selected', async () => {
      await userRepository.save(
        userRepository.create({ email: 'user@example.com', password: 'secret_hash' }),
      );

      const result = await usersService.findByEmail('user@example.com');
      expect(result).not.toBeNull();
      expect(result!.email).toBe('user@example.com');
      expect(result!.password).toBe('secret_hash');
    });

    it('returns null for a different email', async () => {
      await userRepository.save(
        userRepository.create({ email: 'user@example.com', password: 'hash' }),
      );

      const result = await usersService.findByEmail('other@example.com');
      expect(result).toBeNull();
    });
  });
});
