import { Column, Entity, Index, ManyToOne, JoinColumn } from 'typeorm';

import { BaseEntity } from '../../database/base.entity';
import { PaymentProvider, PaymentStatus } from '../enums/payment.enum';
import { Payment } from './payment.entity';
import { PaymentEventType } from '../enums/payment-event.enum';

@Entity('payment_events')
export class PaymentEvent extends BaseEntity {
  @Index()
  @Column({ type: 'varchar' })
  paymentId: string;

  @Column({ type: 'enum', enum: PaymentEventType, enumName: 'payment_event_type' })
  eventType: PaymentEventType;

  @Column({ type: 'enum', enum: PaymentStatus, enumName: 'payment_status', nullable: true })
  status: PaymentStatus | null;

  @Column({ type: 'enum', enum: PaymentProvider, enumName: 'payment_provider', nullable: true })
  provider: PaymentProvider | null;

  // Stripe event ID — used to detect and skip duplicate webhook deliveries
  @Column({ type: 'varchar', nullable: true, unique: true })
  providerEventId: string | null;

  @Column({ type: 'jsonb', nullable: true })
  data: Record<string, any>;

  @ManyToOne(() => Payment, (payment) => payment.events, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'paymentId' })
  payment: Payment;
}
