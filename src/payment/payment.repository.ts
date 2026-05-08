import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Payment } from './entities/payment.entity';
import { PaymentEvent } from './entities/payment-event.entity';
import { PaymentStatus } from './enums/payment.enum';
import { PaymentEventType } from './enums/payment-event.enum';
import { AppError } from '../utils/errors/app-error';

@Injectable()
export class PaymentRepository {
  constructor(
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    @InjectRepository(PaymentEvent) private readonly events: Repository<PaymentEvent>,
  ) {}

  // ── Payment CRUD ──────────────────────────────────────────────────────────

  createPayment(data: Partial<Payment>): Payment {
    return this.payments.create(data);
  }

  savePayment(payment: Payment): Promise<Payment> {
    return this.payments.save(payment);
  }

  findById(id: string): Promise<Payment | null> {
    return this.payments.findOneBy({ id });
  }

  async findByIdOrThrow(id: string): Promise<Payment> {
    const payment = await this.payments.findOneBy({ id });
    if (!payment) throw AppError.notFound(`Payment ${id} not found`);
    return payment;
  }

  findByOrderId(orderId: string, skip: number, take: number): Promise<[Payment[], number]> {
    return this.payments.findAndCount({ where: { orderId }, skip, take, order: { createdAt: 'DESC' } });
  }

  findByUserId(userId: string, skip: number, take: number): Promise<[Payment[], number]> {
    return this.payments.findAndCount({ where: { userId }, skip, take, order: { createdAt: 'DESC' } });
  }

  findByPaymentIntentId(paymentIntentId: string): Promise<Payment | null> {
    return this.payments.findOneBy({ paymentIntentId });
  }

  findByCheckoutSessionId(checkoutSessionId: string): Promise<Payment | null> {
    return this.payments.findOneBy({ checkoutSessionId });
  }

  updatePayment(id: string, data: Partial<Payment>): Promise<Payment> {
    return this.payments.save({ id, ...data });
  }

  updateStatus(id: string, paymentStatus: PaymentStatus): Promise<Payment> {
    return this.payments.save({ id, paymentStatus });
  }

  // ── Payment Events ────────────────────────────────────────────────────────

  createEvent(data: Partial<PaymentEvent>): Promise<PaymentEvent> {
    return this.events.save(this.events.create(data));
  }

  findEventsByPaymentId(paymentId: string): Promise<PaymentEvent[]> {
    return this.events.findBy({ paymentId });
  }

  isEventProcessed(providerEventId: string): Promise<boolean> {
    return this.events.existsBy({ providerEventId, eventType: PaymentEventType.WEBHOOK_PROCESSED });
  }
}
