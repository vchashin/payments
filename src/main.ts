import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(new PrismaExceptionFilter());

  const config = new DocumentBuilder()
    .setTitle('Payments API')
    .setDescription('Wallet service API')
    .setVersion('1.0')
    .build();

  const document = SwaggerModule.createDocument(app, config);

  document.tags = (document.tags ?? []).sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  SwaggerModule.setup('api', app, document, {
    swaggerOptions: { tagsSorter: 'alpha', operationsSorter: 'alpha' },
  });

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  logger.log(`Wallet service running on http://localhost:${port}`);
  logger.log(`Swagger UI available at http://localhost:${port}/api`);
}

void bootstrap();
