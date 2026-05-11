import 'reflect-metadata';
import * as dotenv from 'dotenv';
import { DataSource } from 'typeorm';

import { Payment } from '../payment/entities/payment.entity';
import { PaymentEvent } from '../payment/entities/payment-event.entity';
import { OutboxEvent } from '../outbox/outbox-event.entity';

dotenv.config({ path: '.env.local' });

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [Payment, PaymentEvent, OutboxEvent],
  migrations: ['src/database/migrations/*.ts'],
  synchronize: false,
});
