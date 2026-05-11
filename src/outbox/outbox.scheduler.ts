import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { OutboxService } from './outbox.service';

@Injectable()
export class OutboxScheduler {
  constructor(private readonly outboxService: OutboxService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async sweep(): Promise<void> {
    await this.outboxService.processUnpublished();
  }
}
