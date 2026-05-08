import { MigrationInterface, QueryRunner } from "typeorm";

export class Migration1778275136674 implements MigrationInterface {
    name = 'Migration1778275136674'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "payment_events" DROP CONSTRAINT "FK_c0f8796eab0370f6dc1d8d10db2"`);
        await queryRunner.query(`ALTER TABLE "payment_events" ALTER COLUMN "paymentId" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "payment_events" ADD CONSTRAINT "FK_c0f8796eab0370f6dc1d8d10db2" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "payment_events" DROP CONSTRAINT "FK_c0f8796eab0370f6dc1d8d10db2"`);
        await queryRunner.query(`ALTER TABLE "payment_events" ALTER COLUMN "paymentId" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "payment_events" ADD CONSTRAINT "FK_c0f8796eab0370f6dc1d8d10db2" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

}
