import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';

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

  emitMessage<T>(pattern: string, payload: T): void {
    this.logger.log(`Emitting event: ${pattern}`);

    this.notificationClient.emit(pattern, payload).subscribe({
      error: (error) => {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.error(`Failed to emit event ${pattern}: ${errorMessage}`);
      },
    });
  }

  emitOrderEvent(
    pattern: 'payment.succeeded' | 'payment.failed',
    payload: PaymentSucceededPayload | PaymentFailedPayload,
  ): void {
    this.logger.log(`Emitting order saga event: ${pattern}`);

    this.orderEventsClient.emit(pattern, payload).subscribe({
      error: (error) => {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.error(`Failed to emit order saga event ${pattern}: ${errorMessage}`);
      },
    });
  }
}
