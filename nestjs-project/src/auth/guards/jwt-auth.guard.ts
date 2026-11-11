import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { BEARER_PREFIX } from '../auth.constants';
import { JwtPayload } from '../auth.types';
import { IS_OPTIONAL_AUTH_KEY } from '../decorators/optional-auth.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.isMarked(IS_PUBLIC_KEY, context);
    if (isPublic) return true;

    const request = context
      .switchToHttp()
      .getRequest<{ headers: Record<string, string>; user: unknown }>();
    const payload = await this.verifyBearer(request.headers?.authorization);

    if (payload) {
      request.user = payload;
      return true;
    }
    if (this.isMarked(IS_OPTIONAL_AUTH_KEY, context)) return true;
    throw new UnauthorizedException();
  }

  private isMarked(key: string, context: ExecutionContext): boolean {
    return (
      this.reflector.getAllAndOverride<boolean>(key, [
        context.getHandler(),
        context.getClass(),
      ]) === true
    );
  }

  /** Returns the payload of a valid Bearer token, or null when absent/invalid. */
  private async verifyBearer(
    authHeader: string | undefined,
  ): Promise<JwtPayload | null> {
    if (!authHeader || !authHeader.startsWith(BEARER_PREFIX)) return null;
    try {
      return await this.jwtService.verifyAsync<JwtPayload>(
        authHeader.slice(BEARER_PREFIX.length),
      );
    } catch {
      return null;
    }
  }
}
