import { MigrationInterface, QueryRunner } from "typeorm";

export class Migration1778249335735 implements MigrationInterface {
    name = 'Migration1778249335735'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."payment_event_type" AS ENUM('created', 'processing', 'succeeded', 'failed', 'refunded', 'cancelled', 'webhook_received', 'webhook_processed')`);
        await queryRunner.query(`CREATE TYPE "public"."payment_status" AS ENUM('pending', 'processing', 'paid', 'failed', 'refunded', 'cancelled')`);
        await queryRunner.query(`CREATE TYPE "public"."payment_provider" AS ENUM('stripe', 'paypal')`);
        await queryRunner.query(`CREATE TABLE "payments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "orderId" character varying NOT NULL, "userId" character varying NOT NULL, "paymentIntentId" character varying, "checkoutSessionId" character varying, "refundId" character varying, "paymentProvider" "public"."payment_provider" NOT NULL, "paymentStatus" "public"."payment_status" NOT NULL, "amount" integer NOT NULL, "refundedAmount" integer NOT NULL DEFAULT '0', "currency" character varying(3) NOT NULL, "metadata" jsonb, CONSTRAINT "PK_197ab7af18c93fbb0c9b28b4a59" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_af929a5f2a400fdb6913b4967e" ON "payments" ("orderId") `);
        await queryRunner.query(`CREATE INDEX "IDX_d35cb3c13a18e1ea1705b2817b" ON "payments" ("userId") `);
        await queryRunner.query(`CREATE TABLE "payment_events" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "paymentId" uuid NOT NULL, "eventType" "public"."payment_event_type" NOT NULL, "status" "public"."payment_status", "provider" "public"."payment_provider", "providerEventId" character varying, "data" jsonb, CONSTRAINT "UQ_30d3af1802bbd842d1c53eeef4d" UNIQUE ("providerEventId"), CONSTRAINT "PK_9f1d16fc78b33e676940a32e8b5" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_c0f8796eab0370f6dc1d8d10db" ON "payment_events" ("paymentId") `);
        await queryRunner.query(`ALTER TABLE "payment_events" ADD CONSTRAINT "FK_c0f8796eab0370f6dc1d8d10db2" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "payment_events" DROP CONSTRAINT "FK_c0f8796eab0370f6dc1d8d10db2"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_c0f8796eab0370f6dc1d8d10db"`);
        await queryRunner.query(`DROP TABLE "payment_events"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d35cb3c13a18e1ea1705b2817b"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_af929a5f2a400fdb6913b4967e"`);
        await queryRunner.query(`DROP TABLE "payments"`);
        await queryRunner.query(`DROP TYPE "public"."payment_provider"`);
        await queryRunner.query(`DROP TYPE "public"."payment_status"`);
        await queryRunner.query(`DROP TYPE "public"."payment_event_type"`);
    }

}
