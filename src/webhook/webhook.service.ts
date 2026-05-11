import { Injectable, Logger } from '@nestjs/common';

import { PaypalWebhookEvent } from 'src/paypal/paypal-webhook-event.interface';
import { PaypalService } from 'src/paypal/paypal.service';
import { StripeWebhookEvent } from 'src/stripe/stripe-webhook-event.interface';
import { StripeService } from 'src/stripe/stripe.service';
import { AppError } from 'src/utils/errors/app-error';
import { PaymentService } from '../payment/payment.service';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly stripeService: StripeService,
    private readonly paypalService: PaypalService,
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

  async handlePaypalWebhook(rawBody: Buffer, headers: Record<string, string>): Promise<void> {
    const isValid = await this.paypalService.verifyWebhookSignature(headers, rawBody);
    if (!isValid) {
      this.logger.warn('PayPal webhook signature verification failed');
      throw AppError.badRequest('Invalid webhook signature');
    }

    let event: PaypalWebhookEvent;
    try {
      event = JSON.parse(rawBody.toString()) as PaypalWebhookEvent;
    } catch {
      throw AppError.badRequest('Invalid PayPal webhook payload');
    }

    this.logger.log(`Received PayPal event: ${event.event_type} (${event.id})`);
    await this.paymentService.handlePaypalEvent(event);
  }
}
