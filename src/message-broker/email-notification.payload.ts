export interface EmailNotificationPayload {
  userId?: string;
  to?: string;
  subject: string;
  template: string;
  context?: Record<string, unknown>;
}
