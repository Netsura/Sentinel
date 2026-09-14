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

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const globalPrefix = 'api';
  app.setGlobalPrefix(globalPrefix);
  app.use(cookieParser());
  app.use(requestContextMiddleware);
  app.use(csrfProtection);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  const swaggerConfig = new DocumentBuilder().setTitle('Sentinel API').setDescription('Security monitoring and vulnerability assessment API').setVersion('1.0').addBearerAuth().build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swaggerConfig));
  app.enableCors({
    origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
    credentials: true,
    allowedHeaders: ['Authorization', 'Content-Type', 'x-workspace-id', 'x-csrf-token'],
  });
  const port = process.env.API_PORT || process.env.PORT || 3001;
  await app.listen(port);
  Logger.log(`Sentinel API is running on: http://localhost:${port}/${globalPrefix}`);
}

bootstrap();
