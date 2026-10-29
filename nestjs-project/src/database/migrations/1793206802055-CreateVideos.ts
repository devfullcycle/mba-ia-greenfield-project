import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateVideos1793206802055 implements MigrationInterface {
  name = 'CreateVideos1793206802055';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."videos_processing_status_enum" AS ENUM('UPLOADING', 'PROCESSING', 'READY', 'FAILED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."videos_publication_state_enum" AS ENUM('DRAFT', 'PUBLISHED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "videos" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "public_id" character varying(11) NOT NULL, "channel_id" uuid NOT NULL, "original_filename" character varying(255) NOT NULL, "content_type" character varying(100) NOT NULL, "size_bytes" bigint NOT NULL, "object_key" character varying(512) NOT NULL, "upload_id" character varying(255), "processing_status" "public"."videos_processing_status_enum" NOT NULL DEFAULT 'UPLOADING', "publication_state" "public"."videos_publication_state_enum" NOT NULL DEFAULT 'DRAFT', "failure_reason" character varying(255), "duration_seconds" numeric, "metadata" jsonb, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_39a1f0fe7991162aace659078ec" UNIQUE ("public_id"), CONSTRAINT "PK_e4c86c0cf95aff16e9fb8220f6b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_023a8e4f3f1a34ff3d8ca04a4c" ON "videos" ("channel_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8bcec1c46e7285dd2a30ea58a2" ON "videos" ("processing_status", "updated_at") `,
    );
    await queryRunner.query(
      `ALTER TABLE "videos" ADD CONSTRAINT "FK_023a8e4f3f1a34ff3d8ca04a4cc" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "videos" DROP CONSTRAINT "FK_023a8e4f3f1a34ff3d8ca04a4cc"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8bcec1c46e7285dd2a30ea58a2"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_023a8e4f3f1a34ff3d8ca04a4c"`,
    );
    await queryRunner.query(`DROP TABLE "videos"`);
    await queryRunner.query(
      `DROP TYPE "public"."videos_publication_state_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."videos_processing_status_enum"`,
    );
  }
}
