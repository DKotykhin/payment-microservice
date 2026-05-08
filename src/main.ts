import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';

import { GrpcExceptionFilter } from './utils/filters/grpc-exception.filter';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: process.env.NODE_ENV === 'production' ? ['error'] : ['log', 'debug', 'warn', 'error', 'verbose'],
  });

  const logger = new Logger('Main');

  const configService = app.get(ConfigService);
  const url = configService.getOrThrow<string>('TRANSPORT_URL');
  const PORT = configService.getOrThrow<number>('HTTP_PORT');

  app.useGlobalFilters(new GrpcExceptionFilter());

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.GRPC,
    options: {
      package: [],
      protoPath: [],
      url,
    },
  });

  await app.startAllMicroservices();
  await app.listen(PORT);
  logger.log('Payment microservice is running on ' + url);
  logger.log('HTTP server is running on port ' + PORT);
}
void bootstrap();
