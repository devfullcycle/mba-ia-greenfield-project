import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChannelsService } from '../channels/channels.service';
import { User } from './entities/user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    private readonly channelsService: ChannelsService,
  ) {}

  async createUserWithChannel(
    email: string,
    hashedPassword: string,
  ): Promise<User> {
    const user = this.userRepository.create({
      email,
      password: hashedPassword,
    });
    const savedUser = await this.userRepository.save(user);

    try {
      const channel = await this.channelsService.createChannel(
        savedUser.id,
        email,
      );
      savedUser.channel = channel;
      return savedUser;
    } catch (err) {
      await this.userRepository.delete(savedUser.id);
      throw err;
    }
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.userRepository
      .createQueryBuilder('user')
      .addSelect('user.password')
      .where('user.email = :email', { email })
      .getOne();
  }

  async findByEmailWithChannel(email: string): Promise<User | null> {
    return this.userRepository.findOne({
      where: { email },
      relations: ['channel'],
    });
  }

  async save(user: User): Promise<User> {
    return this.userRepository.save(user);
  }
}
