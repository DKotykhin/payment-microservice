export interface PaymentSucceededPayload {
  orderId: string;
  paymentId: string;
  userId: string;
  amount: number;
  currency: string;
}

export interface PaymentFailedPayload {
  orderId: string;
  paymentId: string;
  userId: string;
  reason?: string;
}
