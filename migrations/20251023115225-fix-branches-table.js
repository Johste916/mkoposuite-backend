'use strict';

/**
 * Goal:
 * - Work ONLY with public."Branches" (the legacy/camel-cased table that has FKs).
 * - Add missing columns: code, phone, address, manager, tenant_id, created_at, updated_at, "createdAt", "updatedAt".
 * - Make optional columns nullable (DROP NOT NULL if present).
 * - Set default NOW() for created_at/updated_at.
 * - Add a trigger to keep updated_at / "updatedAt" in sync on UPDATE.
 * - No views, no new lowercase tables, no FK churn, no data loss.
 */

module.exports = {
  up: async (queryInterface /* , Sequelize */) => {
    const q = (sql) => queryInterface.sequelize.query(sql);

    // 1) Ensure columns exist (idempotent)
    await q(`ALTER TABLE public."Branches" ADD COLUMN IF NOT EXISTS code        varchar NULL;`);
    await q(`ALTER TABLE public."Branches" ADD COLUMN IF NOT EXISTS phone       varchar NULL;`);
    await q(`ALTER TABLE public."Branches" ADD COLUMN IF NOT EXISTS address     varchar NULL;`);
    await q(`ALTER TABLE public."Branches" ADD COLUMN IF NOT EXISTS manager     varchar NULL;`);
    await q(`ALTER TABLE public."Branches" ADD COLUMN IF NOT EXISTS tenant_id   integer NULL;`);
    await q(`ALTER TABLE public."Branches" ADD COLUMN IF NOT EXISTS created_at  timestamptz NULL;`);
    await q(`ALTER TABLE public."Branches" ADD COLUMN IF NOT EXISTS updated_at  timestamptz NULL;`);
    await q(`ALTER TABLE public."Branches" ADD COLUMN IF NOT EXISTS "createdAt" timestamptz NULL;`);
    await q(`ALTER TABLE public."Branches" ADD COLUMN IF NOT EXISTS "updatedAt" timestamptz NULL;`);

    // 2) Make optional columns nullable (in case they were created NOT NULL earlier)
    //    and set sensible defaults for timestamps.
    await q(`
      DO $$
      DECLARE
        must_drop boolean;
      BEGIN
        -- columns that should be nullable
        PERFORM 1;
        FOREACH must_drop IN ARRAY ARRAY[true] LOOP
          -- DROP NOT NULL if present
          IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema='public' AND table_name='Branches' AND column_name='code' AND is_nullable='NO'
          ) THEN
            ALTER TABLE public."Branches" ALTER COLUMN code DROP NOT NULL;
          END IF;

          IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema='public' AND table_name='Branches' AND column_name='phone' AND is_nullable='NO'
          ) THEN
            ALTER TABLE public."Branches" ALTER COLUMN phone DROP NOT NULL;
          END IF;

          IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema='public' AND table_name='Branches' AND column_name='address' AND is_nullable='NO'
          ) THEN
            ALTER TABLE public."Branches" ALTER COLUMN address DROP NOT NULL;
          END IF;

          IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema='public' AND table_name='Branches' AND column_name='manager' AND is_nullable='NO'
          ) THEN
            ALTER TABLE public."Branches" ALTER COLUMN manager DROP NOT NULL;
          END IF;

          IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema='public' AND table_name='Branches' AND column_name='tenant_id' AND is_nullable='NO'
          ) THEN
            ALTER TABLE public."Branches" ALTER COLUMN tenant_id DROP NOT NULL;
          END IF;

          IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema='public' AND table_name='Branches' AND column_name='created_at'
          ) THEN
            ALTER TABLE public."Branches" ALTER COLUMN created_at SET DEFAULT now();
          END IF;

          IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema='public' AND table_name='Branches' AND column_name='updated_at'
          ) THEN
            ALTER TABLE public."Branches" ALTER COLUMN updated_at SET DEFAULT now();
          END IF;
        END LOOP;
      END $$;
    `);

    // 3) Backfill timestamps if they’re NULL (safe/no-op where not needed)
    await q(`UPDATE public."Branches" SET created_at = now() WHERE created_at IS NULL;`);
    await q(`UPDATE public."Branches" SET updated_at = now() WHERE updated_at IS NULL;`);
    // keep camelCase shadows in sync at least once
    await q(`UPDATE public."Branches" SET "createdAt" = created_at WHERE "createdAt" IS NULL;`);
    await q(`UPDATE public."Branches" SET "updatedAt" = updated_at WHERE "updatedAt" IS NULL;`);

    // 4) Add a small trigger to keep updated_at / "updatedAt" fresh on updates
    await q(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'branches_bu_set_updated_at') THEN
          CREATE OR REPLACE FUNCTION public.branches_bu_set_updated_at()
          RETURNS trigger AS $f$
          BEGIN
            NEW.updated_at := now();
            NEW."updatedAt" := NEW.updated_at;
            RETURN NEW;
          END
          $f$ LANGUAGE plpgsql;
        END IF;
      END $$;

      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_Branches_set_updated_at') THEN
          CREATE TRIGGER trg_Branches_set_updated_at
          BEFORE UPDATE ON public."Branches"
          FOR EACH ROW EXECUTE FUNCTION public.branches_bu_set_updated_at();
        END IF;
      END $$;
    `);
  },

  down: async (queryInterface /* , Sequelize */) => {
    // Non-destructive rollback: we won’t drop columns or triggers to avoid breaking code that now relies on them.
    // If you *must* rollback, you can drop the trigger function + trigger below.
    const q = (sql) => queryInterface.sequelize.query(sql);
    await q(`DROP TRIGGER IF EXISTS trg_Branches_set_updated_at ON public."Branches";`);
    await q(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'branches_bu_set_updated_at') THEN
          DROP FUNCTION public.branches_bu_set_updated_at();
        END IF;
      END $$;
    `);
  }
};
