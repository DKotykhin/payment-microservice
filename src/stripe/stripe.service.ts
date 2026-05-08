import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

// Return types are Promise<any> because Stripe v22 CJS types reference internal
// paths that TypeScript cannot name in .d.ts output (declaration: true constraint).
type StripeClient = InstanceType<typeof Stripe>;

@Injectable()
export class StripeService implements OnModuleInit {
  private client: StripeClient;
  private webhookSecret: string;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    this.client = new Stripe(this.configService.getOrThrow<string>('STRIPE_SECRET_KEY'), {
      apiVersion: '2026-04-22.dahlia',
    });
    this.webhookSecret = this.configService.getOrThrow<string>('STRIPE_WEBHOOK_SECRET');
  }

  createPaymentIntent(params: Parameters<StripeClient['paymentIntents']['create']>[0]): Promise<any> {
    return this.client.paymentIntents.create(params);
  }

  retrievePaymentIntent(id: string): Promise<any> {
    return this.client.paymentIntents.retrieve(id);
  }

  cancelPaymentIntent(id: string): Promise<any> {
    return this.client.paymentIntents.cancel(id);
  }

  createCheckoutSession(params: Parameters<StripeClient['checkout']['sessions']['create']>[0]): Promise<any> {
    return this.client.checkout.sessions.create(params);
  }

  createRefund(params: Parameters<StripeClient['refunds']['create']>[0]): Promise<any> {
    return this.client.refunds.create(params);
  }

  // Throws StripeSignatureVerificationError if the signature does not match
  constructWebhookEvent(rawBody: Buffer, signature: string): any {
    return this.client.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
  }
}
