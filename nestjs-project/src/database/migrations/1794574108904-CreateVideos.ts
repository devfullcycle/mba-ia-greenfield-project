import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateVideos1794574108904 implements MigrationInterface {
  name = 'CreateVideos1794574108904';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."videos_status_enum" AS ENUM('DRAFT', 'UPLOADING', 'UPLOADED', 'PROCESSING', 'READY', 'ERROR', 'CANCELLED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "videos" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "channel_id" uuid NOT NULL, "title" character varying(200), "status" "public"."videos_status_enum" NOT NULL DEFAULT 'DRAFT', "storage_key" character varying(500), "thumbnail_key" character varying(500), "upload_id" character varying(255), "mime_type" character varying(100), "file_size" bigint, "duration_seconds" numeric, "metadata" jsonb, "processing_error" text, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_videos_storage_key" UNIQUE ("storage_key"), CONSTRAINT "UQ_videos_upload_id" UNIQUE ("upload_id"), CONSTRAINT "PK_videos_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_videos_channel_status" ON "videos" ("channel_id", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_videos_status" ON "videos" ("status")`,
    );
    await queryRunner.query(
      `ALTER TABLE "videos" ADD CONSTRAINT "FK_videos_channel" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "videos" DROP CONSTRAINT "FK_videos_channel"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_videos_status"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_videos_channel_status"`);
    await queryRunner.query(`DROP TABLE "videos"`);
    await queryRunner.query(`DROP TYPE "public"."videos_status_enum"`);
  }
}
