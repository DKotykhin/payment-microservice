export interface PaypalWebhookEvent {
  id: string;
  event_type: string;
  resource: Record<string, unknown>;
}
