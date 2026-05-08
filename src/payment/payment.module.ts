import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Payment } from './entities/payment.entity';
import { PaymentEvent } from './entities/payment-event.entity';
import { PaymentRepository } from './payment.repository';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Payment, PaymentEvent])],
  controllers: [PaymentController],
  providers: [PaymentRepository, PaymentService],
  exports: [PaymentService],
})
export class PaymentModule {}
