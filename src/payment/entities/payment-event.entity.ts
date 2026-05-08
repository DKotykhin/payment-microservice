import { Column, Entity, Index, ManyToOne, JoinColumn, Unique } from 'typeorm';

import { BaseEntity } from '../../database/base.entity';
import { PaymentProvider, PaymentStatus } from '../enums/payment.enum';
import { Payment } from './payment.entity';
import { PaymentEventType } from '../enums/payment-event.enum';

@Entity('payment_events')
@Unique(['providerEventId', 'eventType'])
export class PaymentEvent extends BaseEntity {
  @Index()
  @Column({ type: 'varchar', nullable: true })
  paymentId: string | null;

  @Column({ type: 'enum', enum: PaymentEventType, enumName: 'payment_event_type' })
  eventType: PaymentEventType;

  @Column({ type: 'enum', enum: PaymentStatus, enumName: 'payment_status', nullable: true })
  status: PaymentStatus | null;

  @Column({ type: 'enum', enum: PaymentProvider, enumName: 'payment_provider', nullable: true })
  provider: PaymentProvider | null;

  @Column({ type: 'varchar', nullable: true })
  providerEventId: string | null;

  @Column({ type: 'jsonb', nullable: true })
  data: Record<string, any>;

  @ManyToOne(() => Payment, (payment) => payment.events, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'paymentId' })
  payment: Payment;
}
