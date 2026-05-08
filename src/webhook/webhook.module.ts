import { Module } from '@nestjs/common';

import { PaymentModule } from '../payment/payment.module';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';

@Module({
  imports: [PaymentModule],
  controllers: [WebhookController],
  providers: [WebhookService],
})
export class WebhookModule {}
