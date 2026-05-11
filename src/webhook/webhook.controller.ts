import { Controller, Headers, HttpCode, HttpStatus, Logger, Post, Req } from '@nestjs/common';

import { WebhookService } from './webhook.service';

@Controller('webhook')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(private readonly webhookService: WebhookService) {}

  @Post('stripe')
  @HttpCode(HttpStatus.OK)
  handleStripeWebhook(@Headers('stripe-signature') signature: string, @Req() req: { rawBody?: Buffer }): Promise<void> {
    this.logger.log('Received Stripe webhook');
    return this.webhookService.handleStripeWebhook(req.rawBody!, signature);
  }

  @Post('paypal')
  @HttpCode(HttpStatus.OK)
  handlePaypalWebhook(@Headers() headers: Record<string, string>, @Req() req: { rawBody?: Buffer }): Promise<void> {
    this.logger.log('Received PayPal webhook');
    return this.webhookService.handlePaypalWebhook(req.rawBody!, headers);
  }
}
