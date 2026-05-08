export enum PaymentEventType {
  CREATED = 'created',
  PROCESSING = 'processing',
  SUCCEEDED = 'succeeded',
  FAILED = 'failed',
  REFUNDED = 'refunded',
  CANCELLED = 'cancelled',
  WEBHOOK_RECEIVED = 'webhook_received',
  WEBHOOK_PROCESSED = 'webhook_processed',
}
