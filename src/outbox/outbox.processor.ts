import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { OutboxService } from './outbox.service';

@Injectable()
export class OutboxProcessor {
  constructor(private readonly outboxService: OutboxService) {}

  @OnEvent('outbox.new')
  async handle(): Promise<void> {
    await this.outboxService.processUnpublished();
  }
}
