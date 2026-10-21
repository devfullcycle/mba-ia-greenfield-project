import { ExecutionContext } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { OptionalAuthGuard } from './optional-auth.guard';

const makeContext = (request: Record<string, unknown>): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => request }),
  }) as unknown as ExecutionContext;

describe('OptionalAuthGuard', () => {
  let guard: OptionalAuthGuard;
  let jwtService: JwtService;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: 'test-secret',
          signOptions: { expiresIn: '15m' },
        }),
      ],
      providers: [OptionalAuthGuard],
    }).compile();
    guard = module.get(OptionalAuthGuard);
    jwtService = module.get(JwtService);
  });

  it('should set request.user when the token is valid', async () => {
    const token = jwtService.sign({ sub: 'user-1', email: 'a@example.com' });
    const request: Record<string, unknown> = {
      headers: { authorization: `Bearer ${token}` },
    };

    await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);

    expect((request.user as { sub: string }).sub).toBe('user-1');
  });

  it('should let the request through without setting request.user when there is no token', async () => {
    const request: Record<string, unknown> = { headers: {} };

    await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);

    expect(request.user).toBeUndefined();
  });

  it('should treat an invalid token as anonymous', async () => {
    const request: Record<string, unknown> = {
      headers: { authorization: 'Bearer not-a-valid-jwt' },
    };

    await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);

    expect(request.user).toBeUndefined();
  });
});
