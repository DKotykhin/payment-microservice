import { Injectable, Logger } from '@nestjs/common';

import { StripeWebhookEvent } from 'src/stripe/stripe-webhook-event.interface';
import { StripeService } from 'src/stripe/stripe.service';
import { AppError } from 'src/utils/errors/app-error';
import { PaymentService } from '../payment/payment.service';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly stripeService: StripeService,
    private readonly paymentService: PaymentService,
  ) {}

  async handleStripeWebhook(rawBody: Buffer, signature: string): Promise<void> {
    let event: StripeWebhookEvent;

    try {
      event = this.stripeService.constructWebhookEvent(rawBody, signature) as StripeWebhookEvent;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Webhook signature verification failed: ${message}`);
      throw AppError.badRequest('Invalid webhook signature');
    }

    this.logger.log(`Received Stripe event: ${event.type} (${event.id})`);
    await this.paymentService.handleStripeEvent(event);
  }
}
