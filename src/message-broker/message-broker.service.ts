import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';

import type { PaymentFailedPayload, PaymentSucceededPayload } from './payment-event.payload';

@Injectable()
export class MessageBrokerService {
  protected readonly logger = new Logger(MessageBrokerService.name);

  constructor(
    @Inject('NOTIFICATION_RMQ_CLIENT')
    private readonly notificationClient: ClientProxy,
    @Inject('ORDER_EVENTS_RMQ_CLIENT')
    private readonly orderEventsClient: ClientProxy,
  ) {}

  async checkConnection(): Promise<void> {
    await this.notificationClient.connect();
    await this.orderEventsClient.connect();
  }

  emitNotification<T>(pattern: string, payload: T): void {
    this.logger.log(`Emitting notification event: ${pattern}`);

    this.notificationClient.emit(pattern, payload).subscribe({
      error: (error) => {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.error(`Failed to emit notification event ${pattern}: ${errorMessage}`);
      },
    });
  }

  emitSagaEvent(
    pattern: 'payment.succeeded' | 'payment.failed',
    payload: PaymentSucceededPayload | PaymentFailedPayload,
  ): void {
    this.logger.log(`Emitting saga event: ${pattern}`);

    this.orderEventsClient.emit(pattern, payload).subscribe({
      error: (error) => {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.error(`Failed to emit saga event ${pattern}: ${errorMessage}`);
      },
    });
  }

  async publishSagaEvent(pattern: string, payload: Record<string, unknown>): Promise<void> {
    this.logger.log(`Publishing saga event (outbox): ${pattern}`);
    await firstValueFrom(this.orderEventsClient.emit(pattern, payload));
  }
}
