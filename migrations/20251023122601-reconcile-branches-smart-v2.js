'use strict';

module.exports = {
  up: async (queryInterface /* , Sequelize */) => {
    const q = (sql) => queryInterface.sequelize.query(sql);

    // 1) Ensure base table public.branches (lowercase) exists
    await q(`
      CREATE TABLE IF NOT EXISTS public.branches (
        id   SERIAL PRIMARY KEY,
        name varchar NOT NULL
      );
    `);

    // 2) Add expected columns (idempotent)
    await q(`ALTER TABLE public.branches ADD COLUMN IF NOT EXISTS code        varchar NULL;`);
    await q(`ALTER TABLE public.branches ADD COLUMN IF NOT EXISTS phone       varchar NULL;`);
    await q(`ALTER TABLE public.branches ADD COLUMN IF NOT EXISTS address     varchar NULL;`);
    await q(`ALTER TABLE public.branches ADD COLUMN IF NOT EXISTS manager     varchar NULL;`);
    await q(`ALTER TABLE public.branches ADD COLUMN IF NOT EXISTS tenant_id   uuid NULL;`);
    await q(`ALTER TABLE public.branches ADD COLUMN IF NOT EXISTS created_at  timestamptz NULL DEFAULT now();`);
    await q(`ALTER TABLE public.branches ADD COLUMN IF NOT EXISTS updated_at  timestamptz NULL DEFAULT now();`);

    // 3) ONLY create the updated_at trigger on LOWERCASE public.branches (never on "Branches")
    await q(`
      DO $$
      DECLARE
        branches_oid oid;
        trig_exists  boolean;
      BEGIN
        SELECT c.oid INTO branches_oid
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname='public' AND c.relname='branches' AND c.relkind='r';

        IF branches_oid IS NOT NULL THEN
          SELECT EXISTS(
            SELECT 1 FROM pg_trigger
            WHERE tgrelid = branches_oid AND tgname = 'trg_branches_set_updated_at'
          ) INTO trig_exists;

          IF NOT trig_exists THEN
            IF NOT EXISTS (
              SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE p.proname='set_updated_at_branches' AND n.nspname='public'
            ) THEN
              CREATE OR REPLACE FUNCTION public.set_updated_at_branches()
              RETURNS trigger AS $f$
              BEGIN
                NEW.updated_at := now();
                RETURN NEW;
              END
              $f$ LANGUAGE plpgsql;
            END IF;

            EXECUTE '
              CREATE TRIGGER trg_branches_set_updated_at
              BEFORE UPDATE ON public.branches
              FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_branches()
            ';
          END IF;
        END IF;
      END $$;
    `);

    // 4) Seed a default branch if empty
    await q(`
      INSERT INTO public.branches (name, code)
      SELECT 'Head Office', '1'
      WHERE NOT EXISTS (SELECT 1 FROM public.branches);
    `);

    // 5) Ensure compatibility relation public."Branches"
    //    - If missing → create VIEW
    //    - If view → replace
    //    - If table → ensure columns only (NO trigger work here to avoid your conflict)
    await q(`
      DO $$
      DECLARE
        rk char;
      BEGIN
        SELECT c.relkind
          INTO rk
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'Branches'
        LIMIT 1;

        IF rk IS NULL THEN
          -- Create VIEW over public.branches
          EXECUTE '
            CREATE VIEW public."Branches" AS
            SELECT
              b.id,
              b.name,
              b.code,
              b.phone,
              b.address,
              b.manager,
              b.tenant_id,
              b.created_at,
              b.updated_at,
              COALESCE(b."createdAt", b.created_at) AS "createdAt",
              COALESCE(b."updatedAt", b.updated_at) AS "updatedAt"
            FROM public.branches b
          ';
        ELSIF rk = 'v' THEN
          EXECUTE '
            CREATE OR REPLACE VIEW public."Branches" AS
            SELECT
              b.id,
              b.name,
              b.code,
              b.phone,
              b.address,
              b.manager,
              b.tenant_id,
              b.created_at,
              b.updated_at,
              COALESCE(b."createdAt", b.created_at) AS "createdAt",
              COALESCE(b."updatedAt", b.updated_at) AS "updatedAt"
            FROM public.branches b
          ';
        ELSIF rk = 'r' THEN
          -- It's a TABLE named "Branches" — ensure expected columns exist, but DO NOT touch triggers.
          EXECUTE 'ALTER TABLE public."Branches" ADD COLUMN IF NOT EXISTS code        varchar NULL';
          EXECUTE 'ALTER TABLE public."Branches" ADD COLUMN IF NOT EXISTS phone       varchar NULL';
          EXECUTE 'ALTER TABLE public."Branches" ADD COLUMN IF NOT EXISTS address     varchar NULL';
          EXECUTE 'ALTER TABLE public."Branches" ADD COLUMN IF NOT EXISTS manager     varchar NULL';
          EXECUTE 'ALTER TABLE public."Branches" ADD COLUMN IF NOT EXISTS tenant_id   uuid NULL';
          EXECUTE 'ALTER TABLE public."Branches" ADD COLUMN IF NOT EXISTS created_at  timestamptz NULL DEFAULT now()';
          EXECUTE 'ALTER TABLE public."Branches" ADD COLUMN IF NOT EXISTS updated_at  timestamptz NULL DEFAULT now()';
        END IF;
      END $$;
    `);

    // 6) Fix sequence on public.branches
    await q(`
      SELECT setval(
        pg_get_serial_sequence('public.branches','id'),
        GREATEST(1, (SELECT COALESCE(MAX(id),1) FROM public.branches)),
        TRUE
      );
    `);
  },

  down: async (queryInterface /* , Sequelize */) => {
    const q = (sql) => queryInterface.sequelize.query(sql);
    // Drop the VIEW only if it is a view (no-op if it's a table)
    await q(`
      DO $$
      DECLARE rk char;
      BEGIN
        SELECT c.relkind
          INTO rk
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'Branches'
        LIMIT 1;

        IF rk = 'v' THEN
          EXECUTE 'DROP VIEW IF EXISTS public."Branches"';
        END IF;
      END $$;
    `);
  }
};
