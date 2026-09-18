import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { WorkspaceRole } from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { ForgotPasswordDto, LoginDto, RegisterDto, ResetPasswordDto, VerifyEmailDto } from './auth.dto';
import { isPlatformAdmin } from './platform-admin';

export type AuthUser = { id: string; email: string };

type TokenPair = { accessToken: string; refreshToken: string };

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
  ) {}

  async register(dto: RegisterDto): Promise<TokenPair & { user: AuthUser }> {
    const email = dto.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('Email is already registered');

    const passwordHash = await argon2.hash(dto.password);
    const verificationToken = randomBytes(32).toString('base64url');

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { email, passwordHash, emailVerified: isPlatformAdmin(email) ? new Date() : undefined },
        select: { id: true, email: true },
      });
      const workspace = await tx.workspace.create({
        data: { name: 'Personal workspace', members: { create: { userId: created.id, role: WorkspaceRole.OWNER } } },
      });
      await tx.emailVerificationToken.create({
        data: { userId: created.id, tokenHash: this.hashToken(verificationToken), expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
      });
      await tx.auditLog.create({
        data: { workspaceId: workspace.id, userId: created.id, action: 'WORKSPACE_CREATED', resource: 'Workspace', resourceId: workspace.id },
      });
      return created;
    });

    await this.mail.sendVerification(user.email, verificationToken);
    const tokens = await this.issueTokens(user);
    return { ...tokens, user };
  }

  async login(dto: LoginDto): Promise<TokenPair & { user: AuthUser }> {
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !(await argon2.verify(user.passwordHash, dto.password))) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const tokens = await this.issueTokens({ id: user.id, email: user.email });
    return { ...tokens, user: { id: user.id, email: user.email } };
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    const tokenHash = this.hashToken(refreshToken);
    const session = await this.prisma.authSession.findUnique({ where: { refreshTokenHash: tokenHash }, include: { user: true } });
    if (!session || session.revokedAt || session.expiresAt <= new Date()) throw new UnauthorizedException('Refresh session is invalid');

    await this.prisma.authSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    return this.issueTokens({ id: session.user.id, email: session.user.email });
  }

  async logout(refreshToken: string) {
    await this.prisma.authSession.updateMany({ where: { refreshTokenHash: this.hashToken(refreshToken), revokedAt: null }, data: { revokedAt: new Date() } });
    return { success: true };
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email.trim().toLowerCase() } });
    if (user) {
      const token = randomBytes(32).toString('base64url');
      await this.prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: this.hashToken(token), expiresAt: new Date(Date.now() + 30 * 60 * 1000) } });
      await this.mail.sendPasswordReset(user.email, token);
    }
    return { message: 'If that email is registered, reset instructions will be sent.' };
  }

  async verifyEmail(dto: VerifyEmailDto) {
    const token = await this.prisma.emailVerificationToken.findUnique({ where: { tokenHash: this.hashToken(dto.token) } });
    if (!token || token.usedAt || token.expiresAt <= new Date()) throw new UnauthorizedException('Verification token is invalid or expired');
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: token.userId }, data: { emailVerified: new Date() } }),
      this.prisma.emailVerificationToken.update({ where: { id: token.id }, data: { usedAt: new Date() } }),
    ]);
    return { success: true };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const tokenHash = this.hashToken(dto.token);
    const reset = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash } });
    if (!reset || reset.usedAt || reset.expiresAt <= new Date()) throw new UnauthorizedException('Reset token is invalid or expired');
    const passwordHash = await argon2.hash(dto.password);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: reset.userId }, data: { passwordHash } }),
      this.prisma.passwordResetToken.update({ where: { id: reset.id }, data: { usedAt: new Date() } }),
      this.prisma.authSession.updateMany({ where: { userId: reset.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    return { success: true };
  }

  async validateAccessToken(payload: { sub?: string; email?: string }): Promise<AuthUser> {
    if (!payload.sub || !payload.email) throw new UnauthorizedException('Invalid access token');
    return { id: payload.sub, email: payload.email };
  }

  private async issueTokens(user: AuthUser): Promise<TokenPair> {
    const accessToken = await this.jwt.signAsync({ sub: user.id, email: user.email }, { expiresIn: '15m' });
    const refreshToken = randomBytes(48).toString('base64url');
    await this.prisma.authSession.create({
      data: { userId: user.id, refreshTokenHash: this.hashToken(refreshToken), expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
    });
    return { accessToken, refreshToken };
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }
}
