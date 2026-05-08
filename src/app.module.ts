import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { validateEnv } from './utils/validators/env-validator';
import { EnvironmentVariables } from './utils/env.dto';
import { DatabaseModule } from './database/database.module';
import { PaymentModule } from './payment/payment.module';
import { StripeModule } from './stripe/stripe.module';
import { WebhookModule } from './webhook/webhook.module';
import { MessageBrokerModule } from './message-broker/message-broker.module';
import { HealthCheckModule } from './health-check/health-check.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local'],
      validate: (config) => validateEnv(config, EnvironmentVariables),
    }),
    DatabaseModule,
    HealthCheckModule,
    MessageBrokerModule,
    PaymentModule,
    StripeModule,
    WebhookModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
