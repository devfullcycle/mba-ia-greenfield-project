import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateVideos1780000000000 implements MigrationInterface {
  name = 'CreateVideos1780000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."video_status_enum" AS ENUM('draft', 'processing', 'ready', 'error')`,
    );
    await queryRunner.query(
      `CREATE TABLE "videos" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "url_code" character varying(12) NOT NULL,
        "title" character varying(255) NOT NULL,
        "description" text,
        "status" "public"."video_status_enum" NOT NULL DEFAULT 'draft',
        "status_details" text,
        "channel_id" uuid NOT NULL,
        "original_filename" character varying(255) NOT NULL,
        "storage_key" character varying(255),
        "thumbnail_key" character varying(255),
        "duration_seconds" double precision,
        "size_bytes" bigint,
        "resolution_width" integer,
        "resolution_height" integer,
        "codec" character varying(50),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_videos_url_code" UNIQUE ("url_code"),
        CONSTRAINT "PK_videos_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_videos_url_code" ON "videos" ("url_code")`,
    );
    await queryRunner.query(
      `ALTER TABLE "videos" ADD CONSTRAINT "FK_videos_channel_id" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "videos" DROP CONSTRAINT "FK_videos_channel_id"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_videos_url_code"`);
    await queryRunner.query(`DROP TABLE "videos"`);
    await queryRunner.query(`DROP TYPE "public"."video_status_enum"`);
  }
}
