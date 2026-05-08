import { Controller } from '@nestjs/common';

import {
  type CancelPaymentRequest,
  type CreateCheckoutSessionRequest,
  type CreateCheckoutSessionResponse,
  type CreatePaymentIntentRequest,
  type CreatePaymentIntentResponse,
  type GetPaymentRequest,
  type GetPaymentsByOrderRequest,
  type GetPaymentsByUserRequest,
  type GetPaymentsResponse,
  type PaymentResponse,
  type PaymentServiceController,
  PaymentServiceControllerMethods,
  type RefundPaymentRequest,
} from 'src/generated-types/payment';
import { PaymentService } from './payment.service';

@Controller()
@PaymentServiceControllerMethods()
export class PaymentController implements PaymentServiceController {
  constructor(private readonly paymentService: PaymentService) {}

  createPaymentIntent(request: CreatePaymentIntentRequest): Promise<CreatePaymentIntentResponse> {
    return this.paymentService.createPaymentIntent(request);
  }

  createCheckoutSession(request: CreateCheckoutSessionRequest): Promise<CreateCheckoutSessionResponse> {
    return this.paymentService.createCheckoutSession(request);
  }

  getPayment(request: GetPaymentRequest): Promise<PaymentResponse> {
    return this.paymentService.getPayment(request);
  }

  getPaymentsByOrder(request: GetPaymentsByOrderRequest): Promise<GetPaymentsResponse> {
    return this.paymentService.getPaymentsByOrder(request);
  }

  getPaymentsByUser(request: GetPaymentsByUserRequest): Promise<GetPaymentsResponse> {
    return this.paymentService.getPaymentsByUser(request);
  }

  refundPayment(request: RefundPaymentRequest): Promise<PaymentResponse> {
    return this.paymentService.refundPayment(request);
  }

  cancelPayment(request: CancelPaymentRequest): Promise<PaymentResponse> {
    return this.paymentService.cancelPayment(request);
  }
}
