'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const qi = queryInterface;
    const t = await qi.sequelize.transaction();
    try {
      // Ensure both tables exist
      await qi.describeTable('Branches');
      const borrowersDesc = await qi.describeTable('Borrowers');

      const hasSnake = !!borrowersDesc.branch_id;
      const hasCamel = !!borrowersDesc.branchId;

      // 1) If both columns exist, mirror values both ways (prefer not-null)
      if (hasSnake && hasCamel) {
        await qi.sequelize.query(`
          UPDATE "Borrowers" b
          SET "branchId" = COALESCE(b."branchId", b."branch_id")
          WHERE b."branch_id" IS NOT NULL AND b."branchId" IS NULL;
        `, { transaction: t });

        await qi.sequelize.query(`
          UPDATE "Borrowers" b
          SET "branch_id" = COALESCE(b."branch_id", b."branchId")
          WHERE b."branchId" IS NOT NULL AND b."branch_id" IS NULL;
        `, { transaction: t });
      }

      // 2) Null out any invalid references that don't exist in Branches
      if (hasSnake) {
        await qi.sequelize.query(`
          UPDATE "Borrowers" b
          SET "branch_id" = NULL
          WHERE b."branch_id" IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM "Branches" br WHERE br.id = b."branch_id");
        `, { transaction: t });
      }

      if (hasCamel) {
        await qi.sequelize.query(`
          UPDATE "Borrowers" b
          SET "branchId" = NULL
          WHERE b."branchId" IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM "Branches" br WHERE br.id = b."branchId");
        `, { transaction: t });
      }

      // 3) Drop any legacy constraint that might be half-created / wrong
      await qi.sequelize.query(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'fk_borrowers_branch_legacy'
              AND conrelid = 'public."Borrowers"'::regclass
          ) THEN
            ALTER TABLE "Borrowers" DROP CONSTRAINT "fk_borrowers_branch_legacy";
          END IF;
        END$$;
      `, { transaction: t });

      // 4) Add helpful indexes (if not exist)
      if (hasSnake) {
        await qi.sequelize.query(`
          CREATE INDEX IF NOT EXISTS "idx_borrowers_branch_id"
            ON "Borrowers" ("branch_id");
        `, { transaction: t });
      }
      if (hasCamel) {
        await qi.sequelize.query(`
          CREATE INDEX IF NOT EXISTS "idx_borrowers_branchId"
            ON "Borrowers" ("branchId");
        `, { transaction: t });
      }

      // 5) Add FKs with ON DELETE SET NULL (idempotent)
      if (hasSnake) {
        await qi.sequelize.query(`
          DO $$
          BEGIN
            IF NOT EXISTS (
              SELECT 1 FROM pg_constraint
              WHERE conname = 'fk_borrowers_branch_id_snake'
                AND conrelid = 'public."Borrowers"'::regclass
            ) THEN
              ALTER TABLE "Borrowers"
                ADD CONSTRAINT "fk_borrowers_branch_id_snake"
                FOREIGN KEY ("branch_id") REFERENCES "Branches"("id")
                ON UPDATE CASCADE ON DELETE SET NULL;
            END IF;
          END$$;
        `, { transaction: t });
      }

      if (hasCamel) {
        await qi.sequelize.query(`
          DO $$
          BEGIN
            IF NOT EXISTS (
              SELECT 1 FROM pg_constraint
              WHERE conname = 'fk_borrowers_branchId_camel'
                AND conrelid = 'public."Borrowers"'::regclass
            ) THEN
              ALTER TABLE "Borrowers"
                ADD CONSTRAINT "fk_borrowers_branchId_camel"
                FOREIGN KEY ("branchId") REFERENCES "Branches"("id")
                ON UPDATE CASCADE ON DELETE SET NULL;
            END IF;
          END$$;
        `, { transaction: t });
      }

      await t.commit();
    } catch (err) {
      await t.rollback();
      throw err;
    }
  },

  down: async (queryInterface) => {
    const qi = queryInterface;
    const t = await qi.sequelize.transaction();
    try {
      // Drop the FK constraints and indexes if present
      await qi.sequelize.query(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'fk_borrowers_branch_id_snake'
              AND conrelid = 'public."Borrowers"'::regclass
          ) THEN
            ALTER TABLE "Borrowers" DROP CONSTRAINT "fk_borrowers_branch_id_snake";
          END IF;

          IF EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'fk_borrowers_branchId_camel'
              AND conrelid = 'public."Borrowers"'::regclass
          ) THEN
            ALTER TABLE "Borrowers" DROP CONSTRAINT "fk_borrowers_branchId_camel";
          END IF;
        END$$;
      `, { transaction: t });

      await qi.sequelize.query(`DROP INDEX IF EXISTS "idx_borrowers_branch_id";`, { transaction: t });
      await qi.sequelize.query(`DROP INDEX IF EXISTS "idx_borrowers_branchId";`, { transaction: t });

      await t.commit();
    } catch (err) {
      await t.rollback();
      throw err;
    }
  }
};
