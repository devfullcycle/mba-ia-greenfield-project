import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateVideos1794273602577 implements MigrationInterface {
  name = 'CreateVideos1794273602577';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."videos_status_enum" AS ENUM('DRAFT', 'PROCESSING', 'READY', 'ERROR')`,
    );
    // Hand-written: TypeORM cannot express a standalone sequence. `seq` is reserved via
    // nextval() before INSERT (public_id = Sqids(seq)). Deliberately no `DEFAULT nextval(...)`:
    // TypeORM reads a `<table>_<column>_seq` default as an increment column, and any
    // `synchronize` run against this table would then DROP the sequence.
    await queryRunner.query(
      `CREATE SEQUENCE "public"."videos_seq_seq" AS bigint`,
    );
    await queryRunner.query(
      `CREATE TABLE "videos" ("id" uuid NOT NULL, "seq" bigint NOT NULL, "public_id" character varying(32) NOT NULL, "channel_id" uuid NOT NULL, "title" character varying(255) NOT NULL, "status" "public"."videos_status_enum" NOT NULL DEFAULT 'DRAFT', "original_filename" character varying(255) NOT NULL, "mime_type" character varying(127) NOT NULL, "size_bytes" bigint NOT NULL, "storage_key" character varying(255) NOT NULL, "thumbnail_key" character varying(255), "upload_id" character varying(255), "duration_seconds" double precision, "width" integer, "height" integer, "codec" character varying(64), "error_reason" character varying(64), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_a8a3d16e7b417f09694f5a92228" UNIQUE ("seq"), CONSTRAINT "UQ_39a1f0fe7991162aace659078ec" UNIQUE ("public_id"), CONSTRAINT "PK_e4c86c0cf95aff16e9fb8220f6b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_023a8e4f3f1a34ff3d8ca04a4c" ON "videos" ("channel_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f12537731f957a3ff27bc19f47" ON "videos" ("status", "updated_at") `,
    );
    await queryRunner.query(
      `ALTER TABLE "videos" ADD CONSTRAINT "FK_023a8e4f3f1a34ff3d8ca04a4cc" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER SEQUENCE "public"."videos_seq_seq" OWNED BY "videos"."seq"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "videos" DROP CONSTRAINT "FK_023a8e4f3f1a34ff3d8ca04a4cc"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f12537731f957a3ff27bc19f47"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_023a8e4f3f1a34ff3d8ca04a4c"`,
    );
    await queryRunner.query(`DROP TABLE "videos"`);
    await queryRunner.query(
      `DROP SEQUENCE IF EXISTS "public"."videos_seq_seq"`,
    );
    await queryRunner.query(`DROP TYPE "public"."videos_status_enum"`);
  }
}
