'use strict';

module.exports = {
  up: async (queryInterface) => {
    const sql = `
DO $$
DECLARE
  rel_oid     oid;
  rel_kind    "char";
  src         regclass;
BEGIN
  -- Is there already something named public.user_branches?
  SELECT c.oid, c.relkind
    INTO rel_oid, rel_kind
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'user_branches';

  IF rel_oid IS NOT NULL AND rel_kind = 'r' THEN
    -- It's a TABLE. Keep it. Just make sure we have a unique index.
    RAISE NOTICE 'Keeping existing TABLE public.user_branches';
    PERFORM 1 FROM pg_indexes
      WHERE schemaname='public' AND indexname='ux_user_branches_user_branch';
    IF NOT FOUND THEN
      -- Try snake_case columns first
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='user_branches' AND column_name='user_id'
      ) AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='user_branches' AND column_name='branch_id'
      ) THEN
        EXECUTE 'CREATE UNIQUE INDEX ux_user_branches_user_branch ON public.user_branches (user_id, branch_id)';
      ELSIF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='user_branches' AND column_name='userId'
      ) AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='user_branches' AND column_name='branchId'
      ) THEN
        -- (Very unlikely, but be tolerant.)
        EXECUTE 'CREATE UNIQUE INDEX ux_user_branches_user_branch ON public.user_branches ("userId", "branchId")';
      END IF;
    END IF;

    RETURN; -- done; nothing else to build
  END IF;

  -- From here on, we (re)build a VIEW named public.user_branches that maps to a source table.

  -- Find a source table to map (prefer camel)
  src := to_regclass('public."UserBranches"');
  IF src IS NULL THEN
    src := to_regclass('public.user_branches');   -- legacy snake table (if any)
  END IF;
  IF src IS NULL THEN
    src := to_regclass('public.userbranches');    -- last-resort name
  END IF;

  -- If no source, create a minimal camel table for dev
  IF src IS NULL THEN
    RAISE NOTICE 'Creating fallback table public."UserBranches"';
    CREATE TABLE IF NOT EXISTS "public"."UserBranches" (
      "id" uuid DEFAULT gen_random_uuid() PRIMARY KEY,
      "userId" uuid NOT NULL,
      "branchId" integer NOT NULL,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    );
    -- Unique pair on camel
    PERFORM 1 FROM pg_indexes
      WHERE schemaname='public' AND indexname='ux_userbranches_user_branch';
    IF NOT FOUND THEN
      CREATE UNIQUE INDEX ux_userbranches_user_branch
        ON "public"."UserBranches" ("userId","branchId");
    END IF;
    src := 'public."UserBranches"'::regclass;
  END IF;

  -- If an object exists with the same name and it's a VIEW, drop & rebuild; if it's NULL, just build.
  IF rel_oid IS NOT NULL AND rel_kind = 'v' THEN
    EXECUTE 'DROP RULE IF EXISTS user_branches_update ON public.user_branches';
    EXECUTE 'DROP RULE IF EXISTS user_branches_delete ON public.user_branches';
    EXECUTE 'DROP RULE IF EXISTS user_branches_insert ON public.user_branches';
    EXECUTE 'DROP VIEW public.user_branches';
  END IF;

  -- Build the view mapped to the detected source
  EXECUTE format($v$
    CREATE OR REPLACE VIEW public.user_branches AS
    SELECT
      ub."userId"::uuid  AS user_id,
      ub."branchId"::int AS branch_id,
      NULL::bigint       AS tenant_id,
      ub."createdAt"     AS created_at
    FROM %s ub
  $v$, src);

  -- Insert rule -> upsert into source
  EXECUTE format($r$
    CREATE OR REPLACE RULE user_branches_insert AS
    ON INSERT TO public.user_branches DO INSTEAD
    INSERT INTO %s ("userId","branchId","createdAt","updatedAt")
    VALUES (NEW.user_id, NEW.branch_id, COALESCE(NEW.created_at, now()), now())
    ON CONFLICT ("userId","branchId") DO NOTHING
  $r$, src);

  -- Delete rule -> delete from source
  EXECUTE format($r$
    CREATE OR REPLACE RULE user_branches_delete AS
    ON DELETE TO public.user_branches DO INSTEAD
    DELETE FROM %s
    WHERE "userId" = OLD.user_id AND "branchId" = OLD.branch_id
  $r$, src);

  -- Update rule -> touch updatedAt
  EXECUTE format($r$
    CREATE OR REPLACE RULE user_branches_update AS
    ON UPDATE TO public.user_branches DO INSTEAD
    UPDATE %s ub
    SET "updatedAt" = now()
    WHERE ub."userId" = OLD.user_id AND ub."branchId" = OLD.branch_id
  $r$, src);

  RAISE NOTICE 'user_branches compat view wired to %', src::text;
END$$;
`;
    await queryInterface.sequelize.query(sql);
  },

  down: async (queryInterface) => {
    const sql = `
DO $$
DECLARE
  rel_kind "char";
BEGIN
  SELECT c.relkind INTO rel_kind
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname='public' AND c.relname='user_branches';

  IF rel_kind = 'v' THEN
    EXECUTE 'DROP RULE IF EXISTS user_branches_update ON public.user_branches';
    EXECUTE 'DROP RULE IF EXISTS user_branches_delete ON public.user_branches';
    EXECUTE 'DROP RULE IF EXISTS user_branches_insert ON public.user_branches';
    EXECUTE 'DROP VIEW public.user_branches';
  ELSE
    -- If it's a TABLE, we leave it intact.
    RAISE NOTICE 'Leaving existing TABLE public.user_branches in place';
  END IF;
END$$;
`;
    await queryInterface.sequelize.query(sql);
  }
};
