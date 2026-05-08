import { MigrationInterface, QueryRunner } from "typeorm";

export class Migration1778276333253 implements MigrationInterface {
    name = 'Migration1778276333253'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "payment_events" DROP CONSTRAINT "UQ_30d3af1802bbd842d1c53eeef4d"`);
        await queryRunner.query(`ALTER TABLE "payment_events" ADD CONSTRAINT "UQ_a4de0a32393cff9fda28b7df804" UNIQUE ("providerEventId", "eventType")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "payment_events" DROP CONSTRAINT "UQ_a4de0a32393cff9fda28b7df804"`);
        await queryRunner.query(`ALTER TABLE "payment_events" ADD CONSTRAINT "UQ_30d3af1802bbd842d1c53eeef4d" UNIQUE ("providerEventId")`);
    }

}
