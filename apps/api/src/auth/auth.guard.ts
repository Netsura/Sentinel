import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService, AuthUser } from './auth.service';

type AuthenticatedRequest = { headers: { authorization?: string }; user?: AuthUser };

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('Bearer token required');
    try {
      const payload = await this.jwt.verifyAsync<{ sub?: string; email?: string }>(header.slice(7));
      request.user = await this.auth.validateAccessToken(payload);
      return true;
    } catch {
      throw new UnauthorizedException('Invalid access token');
    }
  }
}
