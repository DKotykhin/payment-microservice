# Payment Microservice — Stripe Integration Plan

## Context

The payment microservice is freshly scaffolded: gRPC transport, TypeORM/PostgreSQL, env validation, and error utilities are in place, but there is zero business logic. The goal is to implement a production-grade payment service that matches the patterns of the mature microservices in this project (user, store, order) and integrates Stripe as the payment provider.

---

## Architecture Summary

| Concern | Choice | Rationale |
|---|---|---|
| DB ORM | TypeORM (already set up) | Keep what's there; don't mix ORMs |
| Sync comms | gRPC (already configured) | Matches every other service |
| Async events | RabbitMQ (amqp-connection-manager) | Matches user-microservice pattern |
| Stripe webhooks | Hybrid HTTP server on separate port | Webhooks are HTTP POST; NestJS hybrid app adds HTTP alongside gRPC |
| Metrics | @willsoto/nestjs-prometheus | Matches user-microservice |
| Tracing | OpenTelemetry + Jaeger | Matches user-microservice |
| Rate limiting | ThrottlerModule | Matches user-microservice |

---

## Directory Structure (final target)

```
src/
├── main.ts                          (update: hybrid app, metrics endpoint, tracing)
├── app.module.ts                    (update: add all new modules)
├── proto/
│   ├── payment.proto                (new)
│   └── health-check.proto           (new — copy from user-microservice)
├── payment/
│   ├── payment.module.ts
│   ├── payment.controller.ts        (gRPC handler)
│   ├── payment.service.ts
│   ├── payment.repository.ts
│   ├── entities/
│   │   └── payment.entity.ts
│   └── dto/
│       ├── create-payment-intent.dto.ts
│       ├── create-checkout-session.dto.ts
│       └── refund-payment.dto.ts
├── stripe/
│   ├── stripe.module.ts
│   └── stripe.service.ts            (thin Stripe SDK wrapper)
├── webhook/
│   ├── webhook.module.ts
│   ├── webhook.controller.ts        (HTTP POST /webhook/stripe)
│   └── webhook.service.ts           (event dispatch logic)
├── health-check/
│   ├── health-check.module.ts
│   ├── health-check.controller.ts   (gRPC)
│   └── health-check.service.ts
├── transport/
│   └── message-broker/
│       ├── message-broker.module.ts
│       └── message-broker.service.ts
├── supervision/
│   ├── metrics/
│   │   ├── metrics.module.ts
│   │   ├── providers/
│   │   │   ├── grpc.metrics.ts
│   │   │   └── business.metrics.ts
│   │   ├── interceptors/
│   │   │   └── grpc-metrics.interceptor.ts
│   │   └── services/
│   │       └── business-metrics.service.ts
│   └── tracing/
│       └── tracing.ts
├── database/                        (already exists — no changes needed)
└── utils/                           (already exists — no changes needed)
```

---

## Step-by-Step Implementation

### 1. Install Dependencies

```bash
# Stripe SDK
npm install stripe

# RabbitMQ
npm install amqplib amqp-connection-manager
npm install --save-dev @types/amqplib

# Prometheus metrics
npm install @willsoto/nestjs-prometheus prom-client

# OpenTelemetry tracing (match user-microservice versions)
npm install @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node \
  @opentelemetry/exporter-trace-otlp-grpc @opentelemetry/resources \
  @opentelemetry/semantic-conventions

# ThrottlerModule (rate limiting)
npm install @nestjs/throttler
```

### 2. Environment Variables

Add to `src/utils/env.dto.ts` and `.env.example`:
```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
WEBHOOK_PORT=5007         # HTTP port for Stripe webhooks
METRICS_PORT=9105
RABBITMQ_URL=amqp://guest:guest@localhost:5672
JAEGER_ENDPOINT=http://localhost:4317
```

### 3. Proto Definition (`src/proto/payment.proto`)

```protobuf
syntax = "proto3";
package payment.v1;

service PaymentService {
  rpc CreatePaymentIntent(CreatePaymentIntentRequest) returns (CreatePaymentIntentResponse);
  rpc CreateCheckoutSession(CreateCheckoutSessionRequest) returns (CreateCheckoutSessionResponse);
  rpc GetPayment(GetPaymentRequest) returns (PaymentResponse);
  rpc GetPaymentsByOrder(GetPaymentsByOrderRequest) returns (GetPaymentsResponse);
  rpc GetPaymentsByUser(GetPaymentsByUserRequest) returns (GetPaymentsResponse);
  rpc RefundPayment(RefundPaymentRequest) returns (PaymentResponse);
  rpc CancelPayment(CancelPaymentRequest) returns (PaymentResponse);
}

message CreatePaymentIntentRequest {
  string order_id = 1;
  string user_id = 2;
  int64 amount = 3;         // smallest currency unit (cents)
  string currency = 4;      // e.g. "usd"
  map<string, string> metadata = 5;
}

message CreatePaymentIntentResponse {
  string payment_id = 1;
  string client_secret = 2;
  string stripe_payment_intent_id = 3;
  string status = 4;
}

message CreateCheckoutSessionRequest {
  string order_id = 1;
  string user_id = 2;
  int64 amount = 3;
  string currency = 4;
  string success_url = 5;
  string cancel_url = 6;
  map<string, string> metadata = 7;
}

message CreateCheckoutSessionResponse {
  string payment_id = 1;
  string session_url = 2;
  string stripe_session_id = 3;
  string status = 4;
}

message GetPaymentRequest          { string payment_id = 1; }
message GetPaymentsByOrderRequest  { string order_id = 1; }
message GetPaymentsByUserRequest   { string user_id = 1; }
message RefundPaymentRequest       { string payment_id = 1; int64 amount = 2; string reason = 3; }
message CancelPaymentRequest       { string payment_id = 1; }

message PaymentResponse {
  string id = 1;
  string order_id = 2;
  string user_id = 3;
  string stripe_payment_intent_id = 4;
  string stripe_checkout_session_id = 5;
  string stripe_refund_id = 6;
  int64 amount = 7;
  int64 refunded_amount = 8;
  string currency = 9;
  string status = 10;
  string created_at = 11;
  string updated_at = 12;
}

message GetPaymentsResponse { repeated PaymentResponse payments = 1; }
```

### 4. Payment Entity (`src/payment/entities/payment.entity.ts`)

Extends `BaseEntity` (uuid PK, createdAt, updatedAt). Columns:
- `orderId: string` — indexed
- `userId: string` — indexed
- `stripePaymentIntentId: string | null`
- `stripeCheckoutSessionId: string | null`
- `stripeRefundId: string | null`
- `amount: number` — integer (cents)
- `refundedAmount: number` — default 0
- `currency: string` — default 'usd'
- `status: PaymentStatus` — enum: `pending | processing | succeeded | failed | refunded | cancelled`
- `metadata: Record<string, string>` — jsonb column

Reuse: `src/database/base.entity.ts`

### 5. Stripe Module (`src/stripe/`)

`StripeService` wraps the Stripe Node.js SDK:
- `createPaymentIntent(amount, currency, metadata)` → `Stripe.PaymentIntent`
- `createCheckoutSession(params)` → `Stripe.Checkout.Session`
- `retrievePaymentIntent(id)` → `Stripe.PaymentIntent`
- `createRefund(paymentIntentId, amount?, reason?)` → `Stripe.Refund`
- `cancelPaymentIntent(id)` → `Stripe.PaymentIntent`
- `constructWebhookEvent(rawBody, signature, secret)` → `Stripe.Event`

`StripeModule` is `@Global()` — injected with `STRIPE_SECRET_KEY` from ConfigService.

### 6. Payment Module (`src/payment/`)

**`PaymentRepository`** — TypeORM Repository wrapper:
- `create(data)` / `save(payment)` / `findById(id)` / `findByOrderId(orderId)` / `findByUserId(userId)` / `findByStripePaymentIntentId(id)` / `findByStripeSessionId(id)`

**`PaymentService`** — business logic:
- `createPaymentIntent(dto)` → creates DB record (status=`pending`), calls StripeService, updates record with `stripePaymentIntentId`, returns `{ clientSecret, paymentId }`
- `createCheckoutSession(dto)` → same pattern with Checkout Session
- `getPayment(id)` → findById or throw `AppError.notFound()`
- `getPaymentsByOrder(orderId)` → findByOrderId
- `getPaymentsByUser(userId)` → findByUserId
- `refundPayment(paymentId, amount, reason)` → validate status=`succeeded`, call StripeService.createRefund, update record
- `cancelPayment(paymentId)` → validate status=`pending|processing`, call StripeService.cancelPaymentIntent, update record
- `handleWebhookEvent(event)` → dispatches Stripe events, updates DB, emits RabbitMQ events

**`PaymentController`** — gRPC controller, maps proto RPCs to PaymentService calls. Uses `GrpcMetricsInterceptor`.

### 7. Webhook Module (`src/webhook/`)

**`WebhookController`** — HTTP `@Post('/webhook/stripe')`:
- Uses raw body (requires `express.raw({ type: 'application/json' })` mounted before global JSON parser)
- Reads `stripe-signature` header
- Calls `StripeService.constructWebhookEvent()` for signature verification — reject unverified requests
- Delegates to `WebhookService`

**`WebhookService`** — handles Stripe events:
- `payment_intent.succeeded` → update payment status to `succeeded`, emit `payment.succeeded` via MessageBrokerService
- `payment_intent.payment_failed` → update to `failed`, emit `payment.failed`
- `checkout.session.completed` → update to `succeeded`, emit `payment.succeeded`
- `charge.refunded` → update to `refunded`, emit `payment.refunded`

### 8. Message Broker Module (`src/transport/message-broker/`)

Copy pattern from user-microservice (`user-microservice/src/transport/message-broker/`):
- `MessageBrokerService.emitMessage(pattern, payload)` using `amqp-connection-manager`
- Patterns: `payment.succeeded`, `payment.failed`, `payment.refunded`
- Payload: `{ paymentId, orderId, userId, amount, currency }`

### 9. Health Check Module (`src/health-check/`)

Copy pattern from user-microservice — gRPC health check controller + service + `health-check.proto`.

### 10. Supervision — Metrics & Tracing

**Metrics** (model after `user-microservice/src/supervision/metrics/`):
- gRPC server metrics: `grpc_server_started_total`, `grpc_server_handling_seconds`
- Business metrics: `payment_created_total` (labels: currency, status), `stripe_webhook_events_total` (label: event_type)
- Exposed via HTTP GET `/metrics` on `METRICS_PORT`

**Tracing** (model after `user-microservice/src/supervision/tracing/tracing.ts`):
- OpenTelemetry SDK initialized as the very first import in `main.ts`
- Auto-instrumentation for gRPC, HTTP, PostgreSQL

### 11. Update `main.ts`

```typescript
// 1. Import tracing FIRST (before all other imports)
import './supervision/tracing/tracing';

// 2. Create hybrid NestJS app
const app = await NestFactory.create(AppModule, { rawBody: true });

// 3. Mount raw body parser for webhook route BEFORE global JSON parser
app.use('/webhook/stripe', express.raw({ type: 'application/json' }));

// 4. Connect gRPC microservice
app.connectMicroservice<MicroserviceOptions>({
  transport: Transport.GRPC,
  options: {
    package: [HEALTH_CHECK_V1_PACKAGE_NAME, PAYMENT_V1_PACKAGE_NAME],
    protoPath: ['proto/health-check.proto', 'proto/payment.proto'],
    url: grpcUrl,
  },
});

// 5. Apply GrpcExceptionFilter globally (already in utils/filters/)
// 6. Start gRPC + HTTP listener
await app.startAllMicroservices();
await app.listen(webhookPort);
```

### 12. Update `app.module.ts`

Add imports: `PaymentModule`, `StripeModule`, `WebhookModule`, `HealthCheckModule`, `MessageBrokerModule`, `MetricsModule`, `ThrottlerModule`

### 13. TypeORM Migration

```bash
npm run migration:generate -- src/database/migrations/CreatePaymentTable
npm run migration:run
```

### 14. API Gateway Integration

- Add `payment.proto` to `api-gateway/src/proto/`
- Generate TypeScript types → `api-gateway/src/generated-types/payment.ts`
- Add gRPC client config in `api-gateway/src/configs/grpc.config.ts`
- Add `PaymentModule` to API Gateway (controller + service)
- REST endpoints to expose:
  - `POST /payments/intent` → CreatePaymentIntent
  - `POST /payments/checkout` → CreateCheckoutSession
  - `GET /payments/:id` → GetPayment
  - `GET /payments/order/:orderId` → GetPaymentsByOrder
  - `GET /payments/user/:userId` → GetPaymentsByUser
  - `POST /payments/:id/refund` → RefundPayment
  - `POST /payments/:id/cancel` → CancelPayment

---

## Critical Files to Modify

| File | Action |
|---|---|
| `payment-microservice/src/main.ts` | Rewrite as hybrid app with tracing |
| `payment-microservice/src/app.module.ts` | Add all new modules |
| `payment-microservice/src/utils/env.dto.ts` | Add new env vars |
| `payment-microservice/src/database/data-source.ts` | Register Payment entity |
| `api-gateway/src/configs/grpc.config.ts` | Add payment gRPC client |
| `api-gateway/src/app.module.ts` | Add PaymentModule |

## Reuse From Existing Services

| Pattern | Source |
|---|---|
| `AppError` + `RpcErrorCode` | Already in `payment-microservice/src/utils/errors/` |
| `GrpcExceptionFilter` | Already in `payment-microservice/src/utils/filters/` |
| `BaseEntity` | Already in `payment-microservice/src/database/base.entity.ts` |
| `MessageBrokerService` pattern | `user-microservice/src/transport/message-broker/` |
| gRPC metrics interceptors | `user-microservice/src/supervision/metrics/interceptors/` |
| OpenTelemetry tracing setup | `user-microservice/src/supervision/tracing/tracing.ts` |
| Health check controller/service | `user-microservice/src/health-check/` |

---

## Verification

1. **Unit tests**: `npm test` — add tests for `PaymentService` (mock StripeService + repository)
2. **gRPC**: Use `grpcurl` or BloomRPC to call `PaymentService.CreatePaymentIntent` and `GetPayment`
3. **Webhooks**: Use Stripe CLI — `stripe listen --forward-to localhost:5007/webhook/stripe`, then `stripe trigger payment_intent.succeeded`
4. **Database**: Verify rows in `payment` table after each operation
5. **Metrics**: `curl localhost:9105/metrics` — verify `payment_created_total` increments
6. **Full flow**: Call `POST /payments/intent` via API Gateway REST and trace the request end-to-end
7. **RabbitMQ**: Monitor queues at `localhost:15672` for `payment.succeeded` events after a successful payment
