import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { loadEnvFile } from 'node:process';
import { AppModule } from './app/app.module';
import { csrfProtection } from './auth/csrf';
import { requestContextMiddleware } from './common/request-context';

try {
  loadEnvFile();
} catch {
  // Deployments and CI inject env vars directly.
}

function securityHeaders(
  req: { protocol?: string; headers: Record<string, string | string[] | undefined> },
  res: { setHeader: (name: string, value: string) => void },
  next: () => void,
) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  const forwarded = req.headers['x-forwarded-proto'];
  const proto = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (req.protocol === 'https' || proto === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const globalPrefix = 'api';
  app.setGlobalPrefix(globalPrefix);
  const expressApp = app.getHttpAdapter().getInstance() as { set?: (key: string, value: unknown) => void };
  expressApp.set?.('trust proxy', 1);
  app.enableCors({
    origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
    credentials: true,
    allowedHeaders: ['Authorization', 'Content-Type', 'x-workspace-id', 'x-csrf-token'],
  });
  app.use(cookieParser());
  app.use(securityHeaders);
  app.use(requestContextMiddleware);
  app.use(csrfProtection);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  if (process.env.NODE_ENV !== 'production' || process.env.ENABLE_SWAGGER === 'true') {
    const swaggerConfig = new DocumentBuilder().setTitle('Sentinel API').setDescription('Security monitoring and vulnerability assessment API').setVersion('1.0').addBearerAuth().build();
    SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swaggerConfig));
  }
  const port = process.env.API_PORT || process.env.PORT || 3001;
  await app.listen(port, '0.0.0.0');
  Logger.log(`Sentinel API is running on: http://localhost:${port}/${globalPrefix}`);
}

bootstrap();
