import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { Channel } from './entities/channel.entity';
import { User } from './entities/user.entity';
import { appendRandomSuffix, sanitizeNickname } from './nickname.util';

const PG_UNIQUE_VIOLATION = '23505';
const NICKNAME_COLUMN = 'nickname';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    @InjectRepository(Channel) private readonly channelRepository: Repository<Channel>,
    private readonly dataSource: DataSource,
  ) {}

  async createUserWithChannel(email: string, hashedPassword: string): Promise<User> {
    return this.dataSource.transaction(async (manager) => {
      const user = manager.create(User, { email, password: hashedPassword });
      const savedUser = await manager.save(user);

      const emailPrefix = email.split('@')[0];
      const baseNickname = sanitizeNickname(emailPrefix);
      let nickname = baseNickname;

      let channel: Channel | undefined;
      const maxRetries = 5;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        await manager.query('SAVEPOINT channel_insert');
        try {
          const c = manager.create(Channel, { name: nickname, nickname, user_id: savedUser.id });
          await manager.save(c);
          await manager.query('RELEASE SAVEPOINT channel_insert');
          channel = c;
          break;
        } catch (err) {
          await manager.query('ROLLBACK TO SAVEPOINT channel_insert');
          if (
            err instanceof QueryFailedError &&
            (err as any).code === PG_UNIQUE_VIOLATION &&
            (err as any).detail?.includes(NICKNAME_COLUMN) &&
            attempt < maxRetries
          ) {
            nickname = appendRandomSuffix(baseNickname);
          } else {
            throw err;
          }
        }
      }

      if (!channel) {
        throw new Error('Nickname conflict could not be resolved after max retries');
      }

      savedUser.channel = channel;
      return savedUser;
    });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.userRepository
      .createQueryBuilder('user')
      .addSelect('user.password')
      .where('user.email = :email', { email })
      .getOne();
  }

  async findByEmailWithChannel(email: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { email }, relations: ['channel'] });
  }

  async save(user: User): Promise<User> {
    return this.userRepository.save(user);
  }
}
