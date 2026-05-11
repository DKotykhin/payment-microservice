import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface PaypalTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

interface PaypalOrderLink {
  href: string;
  rel: string;
  method: string;
}

interface PaypalOrderResponse {
  id: string;
  status: string;
  links: PaypalOrderLink[];
}

interface PaypalCaptureResponse {
  id: string;
  status: string;
  purchase_units: Array<{
    payments: {
      captures: Array<{
        id: string;
        status: string;
      }>;
    };
  }>;
}

interface PaypalRefundResponse {
  id: string;
  status: string;
}

interface PaypalVerifySignatureResponse {
  verification_status: 'SUCCESS' | 'FAILURE';
}

@Injectable()
export class PaypalService implements OnModuleInit {
  private readonly logger = new Logger(PaypalService.name);

  private baseUrl!: string;
  private clientId!: string;
  private clientSecret!: string;
  private webhookId!: string;

  private cachedToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    const mode = this.configService.getOrThrow<string>('PAYPAL_MODE');
    this.baseUrl = mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
    this.clientId = this.configService.getOrThrow<string>('PAYPAL_CLIENT_ID');
    this.clientSecret = this.configService.getOrThrow<string>('PAYPAL_CLIENT_SECRET');
    this.webhookId = this.configService.getOrThrow<string>('PAYPAL_WEBHOOK_ID');
  }

  // ── Auth ──────────────────────────────────────────────────────────────────

  private async getAccessToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.tokenExpiresAt) {
      return this.cachedToken;
    }

    const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const response = await fetch(`${this.baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`PayPal auth failed (${response.status}): ${text}`);
    }

    const data = (await response.json()) as PaypalTokenResponse;
    this.cachedToken = data.access_token;
    this.tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000; // 60s safety buffer
    return this.cachedToken;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const token = await this.getAccessToken();
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(options.headers as Record<string, string>),
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`PayPal ${path} failed (${response.status}): ${text}`);
    }

    if (response.status === 204 || response.headers.get('content-length') === '0') {
      return {} as T;
    }
    return response.json() as Promise<T>;
  }

  // ── Orders ────────────────────────────────────────────────────────────────

  async createOrder(params: {
    amount: number;
    currency: string;
    returnUrl: string;
    cancelUrl: string;
    metadata: Record<string, string>;
  }): Promise<{ id: string; approveUrl: string }> {
    const { amount, currency, returnUrl, cancelUrl, metadata } = params;
    const value = (amount / 100).toFixed(2);

    const order = await this.request<PaypalOrderResponse>('/v2/checkout/orders', {
      method: 'POST',
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [
          {
            amount: { currency_code: currency.toUpperCase(), value },
            custom_id: metadata['paymentId'] ?? '',
            description: 'Order payment',
          },
        ],
        application_context: {
          return_url: returnUrl,
          cancel_url: cancelUrl,
          user_action: 'PAY_NOW',
        },
      }),
    });

    const approveLink = order.links.find((l) => l.rel === 'approve');
    if (!approveLink) {
      throw new Error(`PayPal order ${order.id} missing approve link`);
    }

    return { id: order.id, approveUrl: approveLink.href };
  }

  async captureOrder(orderId: string): Promise<string> {
    const result = await this.request<PaypalCaptureResponse>(`/v2/checkout/orders/${orderId}/capture`, {
      method: 'POST',
      body: '{}',
    });

    const captureId = result.purchase_units?.[0]?.payments?.captures?.[0]?.id;
    if (!captureId) {
      throw new Error(`No capture ID in PayPal response for order ${orderId}`);
    }
    return captureId;
  }

  // ── Refund ────────────────────────────────────────────────────────────────

  async createRefund(captureId: string, amount?: number, currency?: string): Promise<string> {
    const body =
      amount !== undefined && currency
        ? JSON.stringify({ amount: { value: (amount / 100).toFixed(2), currency_code: currency.toUpperCase() } })
        : '{}';

    const result = await this.request<PaypalRefundResponse>(`/v2/payments/captures/${captureId}/refund`, {
      method: 'POST',
      body,
    });
    return result.id;
  }

  // ── Cancel ────────────────────────────────────────────────────────────────

  // PayPal CAPTURE-intent orders cannot be voided via API — they expire automatically
  // if the merchant never captures them. We log the intent; the caller marks the DB
  // record as CANCELLED and will skip capture if the CHECKOUT.ORDER.APPROVED webhook
  // arrives after cancellation.
  voidOrder(orderId: string): Promise<void> {
    this.logger.log(`PayPal order ${orderId} marked for no-capture; will expire automatically`);
    return Promise.resolve();
  }

  // ── Webhook signature ─────────────────────────────────────────────────────

  async verifyWebhookSignature(headers: Record<string, string>, rawBody: Buffer): Promise<boolean> {
    const token = await this.getAccessToken();

    let webhookEvent: unknown;
    try {
      webhookEvent = JSON.parse(rawBody.toString()) as unknown;
    } catch {
      this.logger.warn('PayPal webhook body is not valid JSON');
      return false;
    }

    const response = await fetch(`${this.baseUrl}/v1/notifications/verify-webhook-signature`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        auth_algo: headers['paypal-auth-algo'],
        cert_url: headers['paypal-cert-url'],
        transmission_id: headers['paypal-transmission-id'],
        transmission_sig: headers['paypal-transmission-sig'],
        transmission_time: headers['paypal-transmission-time'],
        webhook_id: this.webhookId,
        webhook_event: webhookEvent,
      }),
    });

    if (!response.ok) {
      this.logger.warn(`PayPal signature verification request failed: ${response.status}`);
      return false;
    }

    const data = (await response.json()) as PaypalVerifySignatureResponse;
    return data.verification_status === 'SUCCESS';
  }
}
