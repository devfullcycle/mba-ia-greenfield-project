import { DataSource, Repository } from 'typeorm';
import { Channel } from './channel.entity';
import { User } from './user.entity';

describe('Channel entity (integration)', () => {
  let dataSource: DataSource;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      host: process.env.DB_HOST ?? 'db',
      port: Number(process.env.DB_PORT ?? 5432),
      username: process.env.DB_USERNAME ?? 'streamtube',
      password: process.env.DB_PASSWORD ?? 'streamtube',
      database: process.env.DB_DATABASE ?? 'streamtube',
      entities: [User, Channel],
      synchronize: true,
    });
    await dataSource.initialize();
    userRepository = dataSource.getRepository(User);
    channelRepository = dataSource.getRepository(Channel);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM "channels"');
    await dataSource.query('DELETE FROM "users"');
  });

  async function createUser(email: string): Promise<User> {
    return userRepository.save(
      userRepository.create({ email, password: 'hashed' }),
    );
  }

  it('should enforce unique nickname constraint', async () => {
    const user1 = await createUser('u1@example.com');
    const user2 = await createUser('u2@example.com');

    await channelRepository.save(
      channelRepository.create({ name: 'Channel One', nickname: 'chan', user_id: user1.id }),
    );

    await expect(
      channelRepository.save(
        channelRepository.create({ name: 'Channel Two', nickname: 'chan', user_id: user2.id }),
      ),
    ).rejects.toThrow();
  });

  it('should enforce nickname max length of 50 characters', async () => {
    const user = await createUser('u@example.com');
    const longNickname = 'a'.repeat(51);

    await expect(
      channelRepository.save(
        channelRepository.create({ name: 'Chan', nickname: longNickname, user_id: user.id }),
      ),
    ).rejects.toThrow();
  });

  it('should allow null description', async () => {
    const user = await createUser('u@example.com');
    const channel = await channelRepository.save(
      channelRepository.create({ name: 'Chan', nickname: 'chan', user_id: user.id, description: null }),
    );

    expect(channel.description).toBeNull();
  });

  it('should enforce one-to-one relation: one user_id per channel', async () => {
    const user = await createUser('u@example.com');

    await channelRepository.save(
      channelRepository.create({ name: 'Chan', nickname: 'chan1', user_id: user.id }),
    );

    await expect(
      channelRepository.save(
        channelRepository.create({ name: 'Chan2', nickname: 'chan2', user_id: user.id }),
      ),
    ).rejects.toThrow();
  });

  it('should load the related user via the OneToOne relation', async () => {
    const user = await createUser('rel@example.com');
    await channelRepository.save(
      channelRepository.create({ name: 'Chan', nickname: 'relchan', user_id: user.id }),
    );

    const found = await channelRepository.findOne({
      where: { nickname: 'relchan' },
      relations: ['user'],
    });

    expect(found?.user.email).toBe('rel@example.com');
  });
});
