import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUsersAndChannels1775687773260 implements MigrationInterface {
  name = 'CreateUsersAndChannels1775687773260';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "channels" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(50) NOT NULL, "nickname" character varying(50) NOT NULL, "description" text, "user_id" uuid NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_a221f571edb63f68938f1bdd969" UNIQUE ("nickname"), CONSTRAINT "UQ_23dc7937150c9567d37869313ce" UNIQUE ("user_id"), CONSTRAINT "REL_23dc7937150c9567d37869313c" UNIQUE ("user_id"), CONSTRAINT "PK_bc603823f3f741359c2339389f9" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "email" character varying NOT NULL, "password" character varying NOT NULL, "is_confirmed" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "channels" ADD CONSTRAINT "FK_23dc7937150c9567d37869313ce" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "channels" DROP CONSTRAINT "FK_23dc7937150c9567d37869313ce"`,
    );
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(`DROP TABLE "channels"`);
  }
}
