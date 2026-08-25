import { IsEmail } from 'class-validator';

export class ResendConfirmationDto {
  @IsEmail()
  email: string;
}
