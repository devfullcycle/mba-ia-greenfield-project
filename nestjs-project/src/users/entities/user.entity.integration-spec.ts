import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';
import { VerificationToken } from '../../auth/entities/verification-token.entity';
import {
  cleanAllTables,
  createTestDataSource,
} from '../../test/create-test-data-source';
import { Channel } from '../../channels/entities/channel.entity';
import { User } from './user.entity';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken];

describe('User entity (integration)', () => {
  let dataSource: DataSource;
  let userRepository: Repository<User>;

  beforeAll(async () => {
    dataSource = createTestDataSource(ALL_ENTITIES);
    await dataSource.initialize();
    userRepository = dataSource.getRepository(User);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
  });

  it('should auto-generate uuid, created_at, and updated_at', async () => {
    const user = userRepository.create({
      email: 'test@example.com',
      password: 'hashed',
    });
    const saved = await userRepository.save(user);

    expect(saved.id).toBeDefined();
    expect(saved.created_at).toBeInstanceOf(Date);
    expect(saved.updated_at).toBeInstanceOf(Date);
  });

  it('should default is_confirmed to false', async () => {
    const user = userRepository.create({
      email: 'new@example.com',
      password: 'hashed',
    });
    const saved = await userRepository.save(user);

    expect(saved.is_confirmed).toBe(false);
  });

  it('should enforce unique email constraint', async () => {
    await userRepository.save(
      userRepository.create({ email: 'dup@example.com', password: 'hashed' }),
    );

    await expect(
      userRepository.save(
        userRepository.create({ email: 'dup@example.com', password: 'other' }),
      ),
    ).rejects.toThrow();
  });

  it('should exclude password from default select', async () => {
    await userRepository.save(
      userRepository.create({
        email: 'secret@example.com',
        password: 'secret',
      }),
    );

    const found = await userRepository.findOneBy({
      email: 'secret@example.com',
    });
    expect(found?.password).toBeUndefined();
  });

  it('should return password when explicitly selected', async () => {
    await userRepository.save(
      userRepository.create({ email: 'pwd@example.com', password: 'secret' }),
    );

    const found = await userRepository
      .createQueryBuilder('user')
      .addSelect('user.password')
      .where('user.email = :email', { email: 'pwd@example.com' })
      .getOne();

    expect(found?.password).toBe('secret');
  });
});
