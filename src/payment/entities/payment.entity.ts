import { Column, Entity, Index, OneToMany } from 'typeorm';

import { BaseEntity } from '../../database/base.entity';
import { PaymentProvider, PaymentStatus } from '../enums/payment.enum';
import { PaymentEvent } from './payment-event.entity';

export { PaymentStatus, PaymentProvider };

@Entity('payments')
export class Payment extends BaseEntity {
  @Index()
  @Column({ type: 'varchar' })
  orderId: string;

  @Index()
  @Column({ type: 'varchar' })
  userId: string;

  @Column({ type: 'varchar', nullable: true })
  paymentIntentId: string | null;

  @Column({ type: 'varchar', nullable: true })
  checkoutSessionId: string | null;

  @Column({ type: 'varchar', nullable: true })
  refundId: string | null;

  @Column({ type: 'enum', enum: PaymentProvider, enumName: 'payment_provider' })
  paymentProvider: PaymentProvider;

  @Column({ type: 'enum', enum: PaymentStatus, enumName: 'payment_status' })
  paymentStatus: PaymentStatus;

  // Stored in smallest currency unit (e.g. cents) to avoid floating-point issues
  @Column({ type: 'integer' })
  amount: number;

  @Column({ type: 'integer', default: 0 })
  refundedAmount: number;

  @Column({ type: 'varchar', length: 3 })
  currency: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any>;

  @OneToMany(() => PaymentEvent, (event) => event.payment, { cascade: true })
  events: PaymentEvent[];
}
