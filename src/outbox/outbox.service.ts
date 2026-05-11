import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { MessageBrokerService } from 'src/message-broker/message-broker.service';
import { OutboxEvent } from './outbox-event.entity';

@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);

  constructor(
    @InjectRepository(OutboxEvent)
    private readonly repo: Repository<OutboxEvent>,
    private readonly messageBroker: MessageBrokerService,
  ) {}

  async saveEvent(event: string, payload: Record<string, unknown>, manager?: EntityManager): Promise<void> {
    const repo = manager ? manager.getRepository(OutboxEvent) : this.repo;
    await repo.save(repo.create({ event, payload }));
  }

  async processUnpublished(): Promise<void> {
    const events = await this.repo.find({
      where: { published: false },
      order: { createdAt: 'ASC' },
      take: 100,
    });

    for (const event of events) {
      try {
        await this.messageBroker.publishSagaEvent(event.event, event.payload);
        await this.repo.update(event.id, { published: true, publishedAt: new Date() });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`Failed to publish outbox event ${event.id} (${event.event}): ${message}`);
      }
    }
  }
}
