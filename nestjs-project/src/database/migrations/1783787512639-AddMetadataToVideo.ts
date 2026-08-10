import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMetadataToVideo1783787512639 implements MigrationInterface {
  name = 'AddMetadataToVideo1783787512639';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "videos" ADD "metadata" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "videos" DROP COLUMN "metadata"`);
  }
}
