import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';

import { OutboxService } from 'src/outbox/outbox.service';
import type {
  CancelPaymentRequest,
  CreateCheckoutSessionRequest,
  CreateCheckoutSessionResponse,
  CreatePaymentIntentRequest,
  CreatePaymentIntentResponse,
  GetPaymentRequest,
  GetPaymentsByOrderRequest,
  GetPaymentsByUserRequest,
  GetPaymentsResponse,
  PaymentResponse,
  RefundPaymentRequest,
} from 'src/generated-types/payment';
import { EmailNotificationPayload } from 'src/message-broker/email-notification.payload';
import { MessageBrokerService } from 'src/message-broker/message-broker.service';
import { StripeWebhookEvent } from 'src/stripe/stripe-webhook-event.interface';
import { StripeService } from 'src/stripe/stripe.service';
import { AppError } from 'src/utils/errors/app-error';
import { Payment } from './entities/payment.entity';
import { PaymentEventType } from './enums/payment-event.enum';
import { PaymentProvider, PaymentStatus } from './enums/payment.enum';
import { PaymentRepository } from './payment.repository';

// Minimal shapes of Stripe objects used in this service
interface StripePaymentIntent {
  id: string;
  client_secret: string | null;
}

interface StripeCheckoutSession {
  id: string;
  url: string | null;
}

interface StripeRefund {
  id: string;
}

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly repo: PaymentRepository,
    private readonly stripeService: StripeService,
    private readonly messageBroker: MessageBrokerService,
    private readonly outboxService: OutboxService,
    private readonly eventEmitter: EventEmitter2,
    private readonly dataSource: DataSource,
  ) {}

  // ── Public methods ────────────────────────────────────────────────────────

  async createPaymentIntent(dto: CreatePaymentIntentRequest): Promise<CreatePaymentIntentResponse> {
    const payment = await this.repo.savePayment(
      this.repo.createPayment({
        orderId: dto.orderId,
        userId: dto.userId,
        amount: dto.amount,
        currency: dto.currency,
        metadata: dto.metadata,
        paymentProvider: PaymentProvider.STRIPE,
        paymentStatus: PaymentStatus.PENDING,
        refundedAmount: 0,
      }),
    );

    await this.repo.createEvent({
      paymentId: payment.id,
      eventType: PaymentEventType.CREATED,
      status: PaymentStatus.PENDING,
    });

    const pi = await this.callStripe<StripePaymentIntent>(() =>
      this.stripeService.createPaymentIntent({
        amount: dto.amount,
        currency: dto.currency,
        automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
        metadata: { paymentId: payment.id, orderId: dto.orderId, userId: dto.userId },
      }),
    );

    await this.repo.updatePayment(payment.id, {
      paymentIntentId: pi.id,
      paymentStatus: PaymentStatus.PROCESSING,
    });

    await this.repo.createEvent({
      paymentId: payment.id,
      eventType: PaymentEventType.PROCESSING,
      status: PaymentStatus.PROCESSING,
    });

    return {
      paymentId: payment.id,
      clientSecret: pi.client_secret ?? '',
      providerPaymentId: pi.id,
      status: PaymentStatus.PROCESSING,
    };
  }

  async createCheckoutSession(dto: CreateCheckoutSessionRequest): Promise<CreateCheckoutSessionResponse> {
    const payment = await this.repo.savePayment(
      this.repo.createPayment({
        orderId: dto.orderId,
        userId: dto.userId,
        amount: dto.amount,
        currency: dto.currency,
        metadata: dto.metadata,
        paymentProvider: PaymentProvider.STRIPE,
        paymentStatus: PaymentStatus.PENDING,
        refundedAmount: 0,
      }),
    );

    await this.repo.createEvent({
      paymentId: payment.id,
      eventType: PaymentEventType.CREATED,
      status: PaymentStatus.PENDING,
    });

    const session = await this.callStripe<StripeCheckoutSession>(() =>
      this.stripeService.createCheckoutSession({
        mode: 'payment',
        success_url: dto.successUrl,
        cancel_url: dto.cancelUrl,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: dto.currency,
              unit_amount: dto.amount,
              product_data: { name: 'Order payment' },
            },
          },
        ],
        metadata: { paymentId: payment.id, orderId: dto.orderId, userId: dto.userId },
      }),
    );

    await this.repo.updatePayment(payment.id, {
      checkoutSessionId: session.id,
      paymentStatus: PaymentStatus.PROCESSING,
    });

    await this.repo.createEvent({
      paymentId: payment.id,
      eventType: PaymentEventType.PROCESSING,
      status: PaymentStatus.PROCESSING,
    });

    return {
      paymentId: payment.id,
      sessionUrl: session.url ?? '',
      providerSessionId: session.id,
      status: PaymentStatus.PROCESSING,
    };
  }

  async getPayment({ paymentId }: GetPaymentRequest): Promise<PaymentResponse> {
    const payment = await this.repo.findByIdOrThrow(paymentId);
    return this.toPaymentResponse(payment);
  }

  async getPaymentsByOrder({ orderId, page, limit }: GetPaymentsByOrderRequest): Promise<GetPaymentsResponse> {
    const resolvedPage = page > 0 ? page : 1;
    const resolvedLimit = limit > 0 ? Math.min(limit, 100) : 20;
    const [payments, total] = await this.repo.findByOrderId(orderId, (resolvedPage - 1) * resolvedLimit, resolvedLimit);
    return {
      payments: payments.map((p) => this.toPaymentResponse(p)),
      total,
      page: resolvedPage,
      limit: resolvedLimit,
    };
  }

  async getPaymentsByUser({ userId, page, limit }: GetPaymentsByUserRequest): Promise<GetPaymentsResponse> {
    const resolvedPage = page > 0 ? page : 1;
    const resolvedLimit = limit > 0 ? Math.min(limit, 100) : 20;
    const [payments, total] = await this.repo.findByUserId(userId, (resolvedPage - 1) * resolvedLimit, resolvedLimit);
    return {
      payments: payments.map((p) => this.toPaymentResponse(p)),
      total,
      page: resolvedPage,
      limit: resolvedLimit,
    };
  }

  async refundPayment({ paymentId, amount, reason }: RefundPaymentRequest): Promise<PaymentResponse> {
    const payment = await this.repo.findByIdOrThrow(paymentId);

    if (payment.paymentStatus !== PaymentStatus.PAID) {
      throw AppError.unprocessableEntity('Payment is not in paid state');
    }

    const available = payment.amount - payment.refundedAmount;
    if (amount > available) {
      throw AppError.badRequest(`Refund amount ${amount} exceeds available balance ${available}`);
    }

    const refund = await this.callStripe<StripeRefund>(() =>
      this.stripeService.createRefund({
        payment_intent: payment.paymentIntentId ?? undefined,
        amount,
        reason: (reason as 'duplicate' | 'fraudulent' | 'requested_by_customer') || undefined,
      }),
    );

    const newRefundedAmount = payment.refundedAmount + amount;
    const newStatus = newRefundedAmount >= payment.amount ? PaymentStatus.REFUNDED : PaymentStatus.PAID;

    const updated = await this.repo.updatePayment(payment.id, {
      refundId: refund.id,
      refundedAmount: newRefundedAmount,
      paymentStatus: newStatus,
    });

    await this.repo.createEvent({
      paymentId: payment.id,
      eventType: PaymentEventType.REFUNDED,
      status: newStatus,
    });

    this.sendEmailNotification(payment, 'refunded', amount);

    return this.toPaymentResponse(updated);
  }

  async cancelPayment({ paymentId }: CancelPaymentRequest): Promise<PaymentResponse> {
    const payment = await this.repo.findByIdOrThrow(paymentId);

    const cancellableStatuses: PaymentStatus[] = [PaymentStatus.PENDING, PaymentStatus.PROCESSING];
    if (!cancellableStatuses.includes(payment.paymentStatus)) {
      throw AppError.unprocessableEntity(`Cannot cancel payment with status "${payment.paymentStatus}"`);
    }

    if (payment.paymentIntentId) {
      await this.callStripe(() => this.stripeService.cancelPaymentIntent(payment.paymentIntentId!));
    } else if (payment.checkoutSessionId) {
      await this.callStripe(() => this.stripeService.expireCheckoutSession(payment.checkoutSessionId!));
    }

    const updated = await this.repo.updateStatus(payment.id, PaymentStatus.CANCELLED);

    await this.repo.createEvent({
      paymentId: payment.id,
      eventType: PaymentEventType.CANCELLED,
      status: PaymentStatus.CANCELLED,
    });

    return this.toPaymentResponse(updated);
  }

  // ── Webhook entry point (called by WebhookService) ────────────────────────

  async handleStripeEvent(event: StripeWebhookEvent): Promise<void> {
    try {
      await this.repo.createEvent({
        eventType: PaymentEventType.WEBHOOK_RECEIVED,
        providerEventId: event.id,
        data: event,
      });
    } catch {
      // unique constraint violation — event already received, proceed to idempotency check
    }

    if (await this.repo.isEventProcessed(event.id)) {
      this.logger.debug(`Skipping already-processed webhook event: ${event.id}`);
      return;
    }

    const obj = event.data.object;

    switch (event.type) {
      case 'payment_intent.succeeded':
        await this.onPaymentIntentSucceeded(obj);
        break;
      case 'payment_intent.payment_failed':
        await this.onPaymentIntentFailed(obj);
        break;
      case 'checkout.session.completed':
        await this.onCheckoutSessionCompleted(obj);
        break;
      case 'charge.refunded':
        await this.onChargeRefunded(obj);
        break;
      default:
        this.logger.debug(`Unhandled Stripe event type: ${event.type}`);
    }

    try {
      await this.repo.createEvent({
        eventType: PaymentEventType.WEBHOOK_PROCESSED,
        providerEventId: event.id,
      });
    } catch {
      // unique constraint violation — duplicate delivery, already processed
    }
  }

  // ── Private webhook handlers ──────────────────────────────────────────────

  private async onPaymentIntentSucceeded(obj: Record<string, unknown>): Promise<void> {
    const intentId = String(obj['id']);
    const payment = await this.repo.findByPaymentIntentId(intentId);
    if (!payment) {
      this.logger.warn(`payment_intent.succeeded: no payment found for intent ${intentId}`);
      return;
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.update(Payment, { id: payment.id }, { paymentStatus: PaymentStatus.PAID });
      await this.outboxService.saveEvent(
        'payment.succeeded',
        {
          orderId: payment.orderId,
          paymentId: payment.id,
          userId: payment.userId,
          amount: payment.amount,
          currency: payment.currency,
        },
        manager,
      );
    });

    await this.repo.createEvent({
      paymentId: payment.id,
      eventType: PaymentEventType.SUCCEEDED,
      status: PaymentStatus.PAID,
    });
    this.sendEmailNotification(payment, 'succeeded');
    this.eventEmitter.emit('outbox.new');
  }

  private async onPaymentIntentFailed(obj: Record<string, unknown>): Promise<void> {
    const intentId = String(obj['id']);
    const payment = await this.repo.findByPaymentIntentId(intentId);
    if (!payment) {
      this.logger.warn(`payment_intent.payment_failed: no payment found for intent ${intentId}`);
      return;
    }

    const lastPaymentError = obj['last_payment_error'] as Record<string, unknown> | undefined;
    const rawMessage = lastPaymentError?.['message'];
    const reason = typeof rawMessage === 'string' && rawMessage ? rawMessage : undefined;

    await this.dataSource.transaction(async (manager) => {
      await manager.update(Payment, { id: payment.id }, { paymentStatus: PaymentStatus.FAILED });
      await this.outboxService.saveEvent(
        'payment.failed',
        { orderId: payment.orderId, paymentId: payment.id, userId: payment.userId, reason },
        manager,
      );
    });

    await this.repo.createEvent({
      paymentId: payment.id,
      eventType: PaymentEventType.FAILED,
      status: PaymentStatus.FAILED,
    });
    this.sendEmailNotification(payment, 'failed');
    this.eventEmitter.emit('outbox.new');
  }

  private async onCheckoutSessionCompleted(obj: Record<string, unknown>): Promise<void> {
    const sessionId = String(obj['id']);
    const payment = await this.repo.findByCheckoutSessionId(sessionId);
    if (!payment) {
      this.logger.warn(`checkout.session.completed: no payment found for session ${sessionId}`);
      return;
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.update(Payment, { id: payment.id }, { paymentStatus: PaymentStatus.PAID });
      await this.outboxService.saveEvent(
        'payment.succeeded',
        {
          orderId: payment.orderId,
          paymentId: payment.id,
          userId: payment.userId,
          amount: payment.amount,
          currency: payment.currency,
        },
        manager,
      );
    });

    await this.repo.createEvent({
      paymentId: payment.id,
      eventType: PaymentEventType.SUCCEEDED,
      status: PaymentStatus.PAID,
    });
    this.sendEmailNotification(payment, 'succeeded');
    this.eventEmitter.emit('outbox.new');
  }

  private async onChargeRefunded(obj: Record<string, unknown>): Promise<void> {
    const intentId = String(obj['payment_intent']);
    const payment = await this.repo.findByPaymentIntentId(intentId);
    if (!payment || payment.paymentStatus === PaymentStatus.REFUNDED) return;

    await this.repo.updateStatus(payment.id, PaymentStatus.REFUNDED);
    await this.repo.createEvent({
      paymentId: payment.id,
      eventType: PaymentEventType.REFUNDED,
      status: PaymentStatus.REFUNDED,
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async callStripe<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Stripe error: ${message}`);
      throw AppError.internalServerError(message);
    }
  }

  private sendEmailNotification(payment: Payment, event: 'succeeded' | 'failed' | 'refunded', amount?: number): void {
    const subjects: Record<typeof event, string> = {
      succeeded: 'Your payment was successful',
      failed: 'Your payment failed',
      refunded: 'Your refund has been processed',
    };
    const rawAmount = amount ?? payment.amount;
    const formattedAmount = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: payment.currency.toUpperCase(),
    }).format(rawAmount / 100);

    this.messageBroker.emitNotification<EmailNotificationPayload>('notification.email.send', {
      userId: payment.userId,
      subject: subjects[event],
      template: `payment-${event}`,
      context: { orderId: payment.orderId, amount: formattedAmount },
    });
  }

  private toPaymentResponse(payment: Payment): PaymentResponse {
    return {
      id: payment.id,
      orderId: payment.orderId,
      userId: payment.userId,
      providerPaymentId: payment.paymentIntentId ?? '',
      providerSessionId: payment.checkoutSessionId ?? '',
      providerRefundId: payment.refundId ?? '',
      amount: payment.amount,
      refundedAmount: payment.refundedAmount,
      currency: payment.currency,
      status: payment.paymentStatus,
      paymentProvider: payment.paymentProvider,
      createdAt: payment.createdAt,
      updatedAt: payment.updatedAt,
    };
  }
}
