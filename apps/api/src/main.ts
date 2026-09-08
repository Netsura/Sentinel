/**
 * This is not a production server yet!
 * This is only a minimal backend to get started.
 */

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { loadEnvFile } from 'node:process';
import { AppModule } from './app/app.module';
import { ValidationPipe } from '@nestjs/common';

loadEnvFile();

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const globalPrefix = 'api';
  app.setGlobalPrefix(globalPrefix);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  const swaggerConfig = new DocumentBuilder().setTitle('Sentinel API').setDescription('Security monitoring and vulnerability assessment API').setVersion('1.0').addBearerAuth().build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swaggerConfig));
  app.enableCors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:4200' });
  const port = process.env.API_PORT || process.env.PORT || 3001;
  await app.listen(port);
  Logger.log(`Sentinel API is running on: http://localhost:${port}/${globalPrefix}`);
}

bootstrap();
