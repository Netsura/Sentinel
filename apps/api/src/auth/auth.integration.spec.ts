import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../app/app.module';
import { csrfProtection } from './csrf';
import { PrismaService } from '../prisma/prisma.service';

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;

describeIntegration('auth and CSRF integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const email = `csrf-${Date.now()}@sentinel.test`;

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET ??= 'integration-access-secret';
    process.env.JWT_REFRESH_SECRET ??= 'integration-refresh-secret';
    process.env.WEB_ORIGIN ??= 'http://localhost:3000';
    app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    app.use(csrfProtection);
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email } }).catch(() => undefined);
    await app.close();
  });

  it('rejects login without a CSRF token and accepts the same request after issuing one', async () => {
    const denied = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: 'CorrectHorseBattery9!' });
    expect(denied.status).toBe(403);

    const agent = request.agent(app.getHttpServer());
    const csrf = await agent.get('/api/auth/csrf');
    expect(csrf.status).toBe(200);
    expect(csrf.body.csrfToken).toBeTruthy();

    const registered = await agent
      .post('/api/auth/register')
      .set('x-csrf-token', csrf.body.csrfToken)
      .send({ email, password: 'CorrectHorseBattery9!' });
    expect({ status: registered.status, body: registered.body }).toEqual({
      status: 201,
      body: expect.objectContaining({ accessToken: expect.any(String), user: expect.objectContaining({ email }) }),
    });

    const workspace = await prisma.workspace.findFirst({ where: { members: { some: { user: { email } } } }, include: { auditLogs: true } });
    expect(workspace?.auditLogs.some((entry) => entry.action === 'WORKSPACE_CREATED')).toBe(true);
  });
});
