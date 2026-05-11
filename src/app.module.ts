import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';

import { validateEnv } from './utils/validators/env-validator';
import { EnvironmentVariables } from './utils/env.dto';
import { DatabaseModule } from './database/database.module';
import { PaymentModule } from './payment/payment.module';
import { StripeModule } from './stripe/stripe.module';
import { WebhookModule } from './webhook/webhook.module';
import { MessageBrokerModule } from './message-broker/message-broker.module';
import { HealthCheckModule } from './health-check/health-check.module';
import { OutboxModule } from './outbox/outbox.module';
import { PaypalModule } from './paypal/paypal.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local'],
      validate: (config) => validateEnv(config, EnvironmentVariables),
    }),
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    DatabaseModule,
    HealthCheckModule,
    MessageBrokerModule,
    PaymentModule,
    StripeModule,
    WebhookModule,
    OutboxModule,
    PaypalModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
