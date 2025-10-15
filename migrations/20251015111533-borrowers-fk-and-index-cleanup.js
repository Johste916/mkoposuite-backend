'use strict';

/**
 * Cleans Borrowers FKs and duplicate indexes, and installs a sync trigger
 * between branch_id and "branchId".
 */
module.exports = {
  up: async (queryInterface /* , Sequelize */) => {
    const q = (sql, tx) => queryInterface.sequelize.query(sql, { transaction: tx });

    await queryInterface.sequelize.transaction(async (t) => {
      // Ensure both columns exist (idempotent)
      await q(`ALTER TABLE "Borrowers" ADD COLUMN IF NOT EXISTS branch_id integer;`, t);
      await q(`ALTER TABLE "Borrowers" ADD COLUMN IF NOT EXISTS "branchId" integer;`, t);

      // One-time backfill to align both branch columns
      await q(`
        UPDATE "Borrowers" b
        SET "branchId" = b.branch_id
        WHERE b."branchId" IS NULL AND b.branch_id IS NOT NULL;
      `, t);
      await q(`
        UPDATE "Borrowers" b
        SET branch_id = b."branchId"
        WHERE b.branch_id IS NULL AND b."branchId" IS NOT NULL;
      `, t);

      // Remove orphans so FK validation can pass
      await q(`
        UPDATE "Borrowers" b
        SET branch_id = NULL
        WHERE branch_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM "Branches" br WHERE br.id = b.branch_id);
      `, t);
      await q(`
        UPDATE "Borrowers" b
        SET "branchId" = NULL
        WHERE "branchId" IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM "Branches" br WHERE br.id = b."branchId");
      `, t);
      await q(`
        UPDATE "Borrowers" b
        SET loan_officer_id = NULL
        WHERE loan_officer_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM "Users" u WHERE u.id = b.loan_officer_id);
      `, t);

      // Drop extra legacy branch FKs (keep one snake and one camel)
      await q(`ALTER TABLE "Borrowers" DROP CONSTRAINT IF EXISTS "Borrowers_branch_id_fkey";`, t);
      await q(`ALTER TABLE "Borrowers" DROP CONSTRAINT IF EXISTS fk_borrowers_branch_legacy;`, t);

      // Ensure branch_id FK exists & validated
      await q(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'fk_borrowers_branch_id_snake'
          ) THEN
            ALTER TABLE "Borrowers"
            ADD CONSTRAINT fk_borrowers_branch_id_snake
            FOREIGN KEY (branch_id) REFERENCES "Branches"(id)
            ON UPDATE CASCADE ON DELETE SET NULL NOT VALID;
            ALTER TABLE "Borrowers" VALIDATE CONSTRAINT fk_borrowers_branch_id_snake;
          END IF;
        END$$;
      `, t);

      // Ensure "branchId" FK exists & validated
      await q(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'fk_borrowers_branchId_camel'
          ) THEN
            ALTER TABLE "Borrowers"
            ADD CONSTRAINT fk_borrowers_branchId_camel
            FOREIGN KEY ("branchId") REFERENCES "Branches"(id)
            ON UPDATE CASCADE ON DELETE SET NULL NOT VALID;
            ALTER TABLE "Borrowers" VALIDATE CONSTRAINT fk_borrowers_branchId_camel;
          END IF;
        END$$;
      `, t);

      // Recreate loan_officer FK with ON DELETE SET NULL
      await q(`ALTER TABLE "Borrowers" DROP CONSTRAINT IF EXISTS "Borrowers_loanOfficerId_fkey";`, t);
      await q(`
        ALTER TABLE "Borrowers"
        ADD CONSTRAINT "Borrowers_loanOfficerId_fkey"
        FOREIGN KEY (loan_officer_id) REFERENCES "Users"(id)
        ON UPDATE CASCADE ON DELETE SET NULL NOT VALID;
      `, t);
      await q(`ALTER TABLE "Borrowers" VALIDATE CONSTRAINT "Borrowers_loanOfficerId_fkey";`, t);

      // Deduplicate noisy indexes (keep the canonical ones you listed)
      // status (keep "Borrowers_status_idx")
      await q(`DROP INDEX IF EXISTS borrowers_status_idx;`, t);

      // nationalId (unique already exists → drop non-unique)
      await q(`DROP INDEX IF EXISTS borrowers_nationalid_idx;`, t);

      // branch_id (keep "Borrowers_branch_id_idx")
      await q(`DROP INDEX IF EXISTS idx_borrowers_branch_id;`, t);

      // "branchId" (keep "idx_borrowers_branchId")
      await q(`DROP INDEX IF EXISTS "borrowers_branchId_idx";`, t);

      // BEFORE trigger to keep branch_id <-> "branchId" in sync going forward
      await q(`
        CREATE OR REPLACE FUNCTION borrowers_sync_branch_cols() RETURNS trigger AS $$
        BEGIN
          IF NEW."branchId" IS NULL AND NEW.branch_id IS NOT NULL THEN
            NEW."branchId" := NEW.branch_id;
          ELSIF NEW.branch_id IS NULL AND NEW."branchId" IS NOT NULL THEN
            NEW.branch_id := NEW."branchId";
          END IF;
          RETURN NEW;
        END; $$ LANGUAGE plpgsql;
      `, t);

      await q(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_trigger
            WHERE tgrelid = 'public."Borrowers"'::regclass
              AND tgname  = 'trg_borrowers_sync_branch_cols'
          ) THEN
            CREATE TRIGGER trg_borrowers_sync_branch_cols
            BEFORE INSERT OR UPDATE ON "Borrowers"
            FOR EACH ROW EXECUTE FUNCTION borrowers_sync_branch_cols();
          END IF;
        END$$;
      `, t);
    });
  },

  down: async (queryInterface /* , Sequelize */) => {
    const q = (sql, tx) => queryInterface.sequelize.query(sql, { transaction: tx });

    await queryInterface.sequelize.transaction(async (t) => {
      // Remove sync trigger + function
      await q(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM pg_trigger
            WHERE tgrelid = 'public."Borrowers"'::regclass
              AND tgname  = 'trg_borrowers_sync_branch_cols'
          ) THEN
            DROP TRIGGER trg_borrowers_sync_branch_cols ON "Borrowers";
          END IF;
        END$$;
      `, t);
      await q(`DROP FUNCTION IF EXISTS borrowers_sync_branch_cols();`, t);

      // Optionally re-create dropped indexes to roll back dedupe
      await q(`
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='borrowers_status_idx') THEN
            CREATE INDEX borrowers_status_idx ON public."Borrowers" (status);
          END IF;
        END $$;
      `, t);
      await q(`
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='borrowers_nationalid_idx') THEN
            CREATE INDEX borrowers_nationalid_idx ON public."Borrowers" ("nationalId");
          END IF;
        END $$;
      `, t);
      await q(`
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='idx_borrowers_branch_id') THEN
            CREATE INDEX idx_borrowers_branch_id ON public."Borrowers" (branch_id);
          END IF;
        END $$;
      `, t);
      await q(`
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='borrowers_branchId_idx') THEN
            CREATE INDEX "borrowers_branchId_idx" ON public."Borrowers" ("branchId");
          END IF;
        END $$;
      `, t);

      // Put the legacy extra FK back only if needed
      await q(`
        DO $$ BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname='Borrowers_branch_id_fkey'
          ) THEN
            ALTER TABLE "Borrowers"
            ADD CONSTRAINT "Borrowers_branch_id_fkey"
            FOREIGN KEY (branch_id) REFERENCES "Branches"(id);
          END IF;
        END $$;
      `, t);

      // (We purposely do NOT recreate the legacy fk_borrowers_branch_legacy)
    });
  },
};
