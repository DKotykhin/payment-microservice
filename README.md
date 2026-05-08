# Payment Microservice

![NestJS](https://img.shields.io/badge/NestJS-E0234E?style=flat&logo=nestjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=flat&logo=docker&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=flat&logo=postgresql&logoColor=white)
![Stripe](https://img.shields.io/badge/Stripe-008CDD?style=flat&logo=stripe&logoColor=white)
![Jest](https://img.shields.io/badge/Jest-C21325?style=flat&logo=jest&logoColor=white)
![ESLint](https://img.shields.io/badge/ESLint-4B32C3?style=flat&logo=eslint&logoColor=white)
![Prettier](https://img.shields.io/badge/Prettier-F7B93E?style=flat&logo=prettier&logoColor=black)

Handles payment processing for the Coffeedoor platform. Exposes a **gRPC** interface for internal services and an **HTTP** endpoint for Stripe webhook delivery.

---

## Architecture

- **Transport:** gRPC on `TRANSPORT_URL` (consumed by the API gateway)
- **Webhook:** HTTP POST `/webhook/stripe` (called by Stripe)
- **Payments:** Stripe PaymentIntents and Checkout Sessions
- **Database:** PostgreSQL via TypeORM — `payments` and `payment_events` tables
- **Notifications:** Payment status emails via RabbitMQ → notification microservice

### Payment flow

```
Client → API Gateway → PaymentService.createPaymentIntent (gRPC)
                              ↓
                         Stripe API
                              ↓ (async)
                    POST /webhook/stripe
                              ↓
                    PaymentService.handleStripeEvent
                              ↓
                    Update payment status + send email
```

### payment_events table

Records a timeline of every payment lifecycle event. Serves two purposes:
- **Audit log** — full history of `created → processing → succeeded/failed/refunded`
- **Deduplication** — prevents double-processing of Stripe webhook retries via `providerEventId`

---

## Environment Variables

| Variable | Description |
|---|---|
| `NODE_ENV` | Runtime environment (`development` / `production`) |
| `TRANSPORT_URL` | gRPC bind address (e.g. `0.0.0.0:5006`) |
| `HTTP_PORT` | HTTP server port for webhook endpoint (e.g. `4242`) |
| `DATABASE_URL` | PostgreSQL connection URL |
| `RABBITMQ_URL` | RabbitMQ connection URL |
| `RABBITMQ_QUEUE` | Queue name for notification events |
| `STRIPE_SECRET_KEY` | Stripe secret key (`sk_test_...` or `sk_live_...`) |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret (`whsec_...`) |

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

## Stripe Webhook (local development)

Stripe cannot reach `localhost` directly. Use the Stripe CLI to forward events:

```bash
# 1. Login (first time or after session expiry)
stripe login

# 2. Forward webhook events to the local server
stripe listen --forward-to localhost:4242/webhook/stripe
```

Copy the `whsec_...` printed by the CLI into `.env.local` as `STRIPE_WEBHOOK_SECRET`, then restart the service.

To simulate events manually:

```bash
# Trigger a successful payment
stripe trigger payment_intent.succeeded

# Confirm a specific PaymentIntent with a test card
stripe payment_intents confirm <pi_id> --payment-method pm_card_visa
```

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
