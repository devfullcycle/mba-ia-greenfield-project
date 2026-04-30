import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtPayload } from './auth.types';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { ConfirmEmailDto } from './dto/confirm-email.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
import { ResendConfirmationDto } from './dto/resend-confirmation.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  async register(@Body() dto: RegisterDto): Promise<{ id: string; email: string }> {
    return this.authService.register(dto);
  }

  @Public()
  @Post('confirm-email')
  @HttpCode(HttpStatus.NO_CONTENT)
  async confirmEmail(@Body() dto: ConfirmEmailDto): Promise<void> {
    return this.authService.confirm(dto.token);
  }

  @Public()
  @Post('resend-confirmation')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resendConfirmation(@Body() dto: ResendConfirmationDto): Promise<void> {
    return this.authService.resendConfirmation(dto.email);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto): Promise<{ access_token: string; refresh_token: string }> {
    return this.authService.login(dto);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Body() dto: RefreshTokenDto,
  ): Promise<{ access_token: string; refresh_token: string }> {
    return this.authService.refresh(dto.refresh_token);
  }

  @Get('me')
  me(@CurrentUser() user: JwtPayload): JwtPayload {
    return user;
  }
}
