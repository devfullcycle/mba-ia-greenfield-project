import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateVideos1783990000000 implements MigrationInterface {
  name = 'CreateVideos1783990000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."video_status_enum" AS ENUM('draft', 'processing', 'ready', 'error')`,
    );
    await queryRunner.query(
      `CREATE TABLE "videos" (` +
        `"id" uuid NOT NULL DEFAULT uuid_generate_v4(), ` +
        `"title" character varying(255) NOT NULL, ` +
        `"status" "public"."video_status_enum" NOT NULL DEFAULT 'draft', ` +
        `"channel_id" uuid NOT NULL, ` +
        `"storage_key" character varying NOT NULL, ` +
        `"thumbnail_key" character varying, ` +
        `"duration_seconds" integer, ` +
        `"processing_metadata" jsonb, ` +
        `"error_cause" character varying(2048), ` +
        `"created_at" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `"updated_at" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "PK_e4c86c0cf95aff16e9fb8220f6b" PRIMARY KEY ("id")` +
        `)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_videos_channel_id" ON "videos" ("channel_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_videos_channel_id_created_at" ON "videos" ("channel_id", "created_at" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_videos_status" ON "videos" ("status")`,
    );
    await queryRunner.query(
      `ALTER TABLE "videos" ADD CONSTRAINT "FK_videos_channel_id" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "videos" DROP CONSTRAINT "FK_videos_channel_id"`,
    );
    await queryRunner.query(`DROP INDEX "idx_videos_status"`);
    await queryRunner.query(`DROP INDEX "idx_videos_channel_id_created_at"`);
    await queryRunner.query(`DROP INDEX "idx_videos_channel_id"`);
    await queryRunner.query(`DROP TABLE "videos"`);
    await queryRunner.query(`DROP TYPE "public"."video_status_enum"`);
  }
}
