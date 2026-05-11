# Payment Microservice

![NestJS](https://img.shields.io/badge/NestJS-E0234E?style=flat&logo=nestjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=flat&logo=docker&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=flat&logo=postgresql&logoColor=white)
![Stripe](https://img.shields.io/badge/Stripe-008CDD?style=flat&logo=stripe&logoColor=white)
![PayPal](https://img.shields.io/badge/PayPal-003087?style=flat&logo=paypal&logoColor=white)
![Jest](https://img.shields.io/badge/Jest-C21325?style=flat&logo=jest&logoColor=white)
![ESLint](https://img.shields.io/badge/ESLint-4B32C3?style=flat&logo=eslint&logoColor=white)
![Prettier](https://img.shields.io/badge/Prettier-F7B93E?style=flat&logo=prettier&logoColor=black)

Handles payment processing for the Coffeedoor platform. Exposes a **gRPC** interface for internal services and **HTTP** endpoints for Stripe and PayPal webhook delivery.

---

## Architecture

- **Transport:** gRPC on `TRANSPORT_URL` (consumed by the API gateway)
- **Webhooks:** HTTP POST `/webhook/stripe` and `/webhook/paypal`
- **Payments:** Stripe (PaymentIntents + Checkout Sessions) and PayPal (Checkout Sessions / Orders API)
- **Database:** PostgreSQL via TypeORM — `payments`, `payment_events`, and `outbox_events` tables
- **Notifications:** Payment status emails via RabbitMQ → notification microservice
- **Saga:** Publishes `payment.succeeded` / `payment.failed` events via RabbitMQ → order microservice (guaranteed via Outbox Pattern)

### Stripe payment flow

```
Client → API Gateway → PaymentService.createPaymentIntent (gRPC)
                              ↓
                         Stripe API
                              ↓ (async)
                    POST /webhook/stripe
                              ↓
                    PaymentService.handleStripeEvent
                              ↓
              ┌───────────────┴───────────────┐
          succeeded                        failed
              ↓                               ↓
   ┌──── DB transaction ────┐     ┌──── DB transaction ────┐
   │ status → PAID          │     │ status → FAILED        │
   │ outbox_events INSERT   │     │ outbox_events INSERT   │
   └────────────────────────┘     └────────────────────────┘
              ↓                               ↓
   email notification               email notification
   outbox → 'payment.succeeded'    outbox → 'payment.failed'
              ↓                               ↓
   order-microservice                order-microservice
   PENDING → CONFIRMED               PENDING → CANCELLED
                                     stock released
```

### PayPal payment flow

```
Client → API Gateway → PaymentService.createCheckoutSession (gRPC, provider: "paypal")
                              ↓
                     PayPal Orders API (create order)
                              ↓
                   Returns approve URL to client
                              ↓
                  User redirected to PayPal to approve
                              ↓ (async)
                  POST /webhook/paypal  ← CHECKOUT.ORDER.APPROVED
                              ↓
                  PaypalService.captureOrder (capture ID stored in DB)
                              ↓ (async)
                  POST /webhook/paypal  ← PAYMENT.CAPTURE.COMPLETED
                              ↓
              ┌───────────────┴───────────────┐
          COMPLETED                         DENIED
              ↓                               ↓
   ┌──── DB transaction ────┐     ┌──── DB transaction ────┐
   │ status → PAID          │     │ status → FAILED        │
   │ outbox_events INSERT   │     │ outbox_events INSERT   │
   └────────────────────────┘     └────────────────────────┘
```

### payment_events table

Records a timeline of every payment lifecycle event. Serves two purposes:
- **Audit log** — full history of `created → processing → succeeded/failed/refunded`
- **Deduplication** — prevents double-processing of Stripe webhook retries via `providerEventId`

### Outbox Pattern (reliable saga events)

`payment.succeeded` and `payment.failed` are saga-critical — losing them would leave an order stuck. To guarantee delivery, the service uses the **Transactional Outbox Pattern**:

1. The payment status update and the outbox event write happen in a **single DB transaction** — they either both commit or both roll back.
2. A **`@OnEvent('outbox.new')`** handler fires immediately after the transaction to publish pending events to RabbitMQ.
3. A **`@Cron(EVERY_MINUTE)` sweep** picks up any events that were not published (e.g. app crashed between commit and emit).

Because the same event can be delivered more than once, the order-microservice consumer must deduplicate on the event `id`.

---

## Environment Variables

| Variable | Description |
|---|---|
| `NODE_ENV` | Runtime environment (`development` / `production`) |
| `TRANSPORT_URL` | gRPC bind address (e.g. `0.0.0.0:5006`) |
| `HTTP_PORT` | HTTP server port for webhook endpoint (e.g. `4242`) |
| `DATABASE_URL` | PostgreSQL connection URL |
| `RABBITMQ_URL` | RabbitMQ connection URL |
| `NOTIFICATION_RABBITMQ_QUEUE` | Queue name for notification events |
| `ORDER_EVENTS_RABBITMQ_QUEUE` | Queue name for order saga events (`payment.succeeded` / `payment.failed`) |
| `STRIPE_SECRET_KEY` | Stripe secret key (`sk_test_...` or `sk_live_...`) |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret (`whsec_...`) |
| `PAYPAL_CLIENT_ID` | PayPal app client ID |
| `PAYPAL_CLIENT_SECRET` | PayPal app client secret |
| `PAYPAL_WEBHOOK_ID` | PayPal webhook ID (from developer dashboard) |
| `PAYPAL_MODE` | `sandbox` (local/staging) or `live` (production) |

Copy `.env.example` to `.env.local` and fill in values before running locally.

---

## Setup

```bash
npm install
```

## Database

The schema is managed via TypeORM migrations. `synchronize` is disabled — all schema changes must go through migration files.

```bash
# create the database (first time only — Postgres runs in Docker)
docker exec postgres-database psql -U postgres -c "CREATE DATABASE payment_db;"

# apply all pending migrations
npm run migration:run
```

### Migration commands

```bash
# generate a migration from entity changes
npm run migration:generate

# apply pending migrations
npm run migration:run

# revert the last applied migration
npm run migration:revert

# list applied / pending migrations
npm run migration:show
```

---

## Running

```bash
# development (watch mode)
npm run start:dev

# production
npm run start:prod
```

---

## Webhook local development

### Stripe

Stripe cannot reach `localhost` directly. Use the Stripe CLI to forward events:

```bash
# 1. Login (first time or after session expiry)
stripe login

# 2. Forward webhook events to the local server
stripe listen --forward-to localhost:9106/webhook/stripe
```

Copy the `whsec_...` printed by the CLI into `.env.local` as `STRIPE_WEBHOOK_SECRET`, then restart the service.

To simulate events manually:

```bash
# Trigger a successful payment
stripe trigger payment_intent.succeeded

# Confirm a specific PaymentIntent with a test card
stripe payment_intents confirm <pi_id> --payment-method pm_card_visa
```

### PayPal

PayPal requires a publicly reachable URL. Use [ngrok](https://ngrok.com) to expose the local server:

```bash
# Install (macOS)
brew install ngrok/ngrok/ngrok

# Authenticate once
ngrok config add-authtoken <your-token>

# Expose the local HTTP server
ngrok http 9106
```

Register the forwarding URL in the [PayPal Developer Dashboard](https://developer.paypal.com) under **Webhooks**:

```
https://<your-ngrok-id>.ngrok-free.app/webhook/paypal
```

Subscribe to these events:
- `CHECKOUT.ORDER.APPROVED`
- `PAYMENT.CAPTURE.COMPLETED`
- `PAYMENT.CAPTURE.DENIED`
- `PAYMENT.CAPTURE.REFUNDED`

Copy the **Webhook ID** shown after saving into `.env.local` as `PAYPAL_WEBHOOK_ID`.

Use sandbox buyer credentials (from the PayPal Developer Dashboard → **Sandbox Accounts**) to complete test payments at `https://www.sandbox.paypal.com`. The PayPal dashboard also has a **webhook simulator** to fire individual events without completing a real payment flow.

---

## gRPC API

Proto file: `proto/payment.proto`

To regenerate TypeScript types after editing the proto:

```bash
protoc -I ./proto ./proto/payment.proto --ts_proto_out=./src/generated-types --ts_proto_opt=nestJs=true
```

### Methods

| Method | Request | Response |
|---|---|---|
| `CreatePaymentIntent` | `order_id`, `user_id`, `amount` (cents), `currency`, `metadata` | `payment_id`, `client_secret`, `stripe_payment_intent_id`, `status` |
| `CreateCheckoutSession` | `order_id`, `user_id`, `amount` (cents), `currency`, `success_url`, `cancel_url`, `metadata` | `payment_id`, `session_url`, `stripe_session_id`, `status` |
| `GetPayment` | `payment_id` | `PaymentResponse` |
| `GetPaymentsByOrder` | `order_id`, `page`, `limit` | `payments[]`, `total`, `page`, `limit` |
| `GetPaymentsByUser` | `user_id`, `page`, `limit` | `payments[]`, `total`, `page`, `limit` |
| `RefundPayment` | `payment_id`, `amount` (cents), `reason` | `PaymentResponse` |
| `CancelPayment` | `payment_id` | `PaymentResponse` |

**Notes:**
- `amount` is always in the **smallest currency unit** (cents for USD)
- `page` and `limit` default to `1` and `20` if omitted; `limit` is capped at `100`
- `CreatePaymentIntent` uses `automatic_payment_methods` with `allow_redirects: never` — no `return_url` required

---

## Tests

```bash
# unit tests
npm run test

# unit tests in watch mode
npm run test:watch

# coverage report
npm run test:cov

# e2e tests
npm run test:e2e
```

---
