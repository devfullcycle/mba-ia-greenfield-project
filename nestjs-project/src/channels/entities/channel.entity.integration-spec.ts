import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';
import { VerificationToken } from '../../auth/entities/verification-token.entity';
import {
  cleanAllTables,
  createTestDataSource,
} from '../../test/create-test-data-source';
import { User } from '../../users/entities/user.entity';
import { Channel } from './channel.entity';
import { Video } from '../../videos/entities/video.entity';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];

describe('Channel entity (integration)', () => {
  let dataSource: DataSource;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;

  beforeAll(async () => {
    dataSource = createTestDataSource(ALL_ENTITIES);
    await dataSource.initialize();
    userRepository = dataSource.getRepository(User);
    channelRepository = dataSource.getRepository(Channel);
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
        email: `ch_user_${++userCounter}@example.com`,
        password: 'hashed',
      }),
    );
  }

  it('should enforce unique nickname constraint', async () => {
    const user1 = await createUser();
    const user2 = await createUser();

    await channelRepository.save(
      channelRepository.create({
        name: 'Channel One',
        nickname: 'chan',
        user_id: user1.id,
      }),
    );

    await expect(
      channelRepository.save(
        channelRepository.create({
          name: 'Channel Two',
          nickname: 'chan',
          user_id: user2.id,
        }),
      ),
    ).rejects.toThrow();
  });

  it('should enforce nickname max length of 50 characters', async () => {
    const user = await createUser();
    const longNickname = 'a'.repeat(51);

    await expect(
      channelRepository.save(
        channelRepository.create({
          name: 'Chan',
          nickname: longNickname,
          user_id: user.id,
        }),
      ),
    ).rejects.toThrow();
  });

  it('should allow null description', async () => {
    const user = await createUser();
    const channel = await channelRepository.save(
      channelRepository.create({
        name: 'Chan',
        nickname: 'chan',
        user_id: user.id,
        description: null,
      }),
    );

    expect(channel.description).toBeNull();
  });

  it('should enforce one-to-one relation: one user_id per channel', async () => {
    const user = await createUser();

    await channelRepository.save(
      channelRepository.create({
        name: 'Chan',
        nickname: 'chan1',
        user_id: user.id,
      }),
    );

    await expect(
      channelRepository.save(
        channelRepository.create({
          name: 'Chan2',
          nickname: 'chan2',
          user_id: user.id,
        }),
      ),
    ).rejects.toThrow();
  });

  it('should load the related user via the OneToOne relation', async () => {
    const user = await createUser();
    await channelRepository.save(
      channelRepository.create({
        name: 'Chan',
        nickname: 'relchan',
        user_id: user.id,
      }),
    );

    const found = await channelRepository.findOne({
      where: { nickname: 'relchan' },
      relations: ['user'],
    });

    expect(found?.user.email).toBe(user.email);
  });
});
