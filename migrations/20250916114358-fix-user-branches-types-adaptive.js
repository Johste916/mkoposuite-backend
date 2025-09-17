'use strict';

/**
 * Adaptive + safe:
 * - If public.user_branches is a VIEW, we skip altering it and operate on the real table if present (public."UserBranches").
 * - If public.user_branches is a TABLE, we operate on it directly.
 * - Only alters columns that exist; creates a unique index on the physical table.
 * - No-op if neither physical form exists.
 */
module.exports = {
  up: async (queryInterface /*, Sequelize */) => {
    const sql = `
DO $mig$
DECLARE
  -- Object existence + kind
  has_snake_tbl  boolean := FALSE;
  has_snake_view boolean := FALSE;
  has_camel_tbl  boolean := FALSE;

  tgt_schema text := 'public';
  tgt_table  text := NULL;      -- physical table we will alter
  -- Column existence flags for the chosen target
  has_user   boolean := FALSE;
  has_branch boolean := FALSE;
  has_tenant boolean := FALSE;

  -- Helpers
  relkind_snake text;
BEGIN
  -- Detect snake object + kind (r = table, v = view, m = materialized view)
  SELECT c.relkind
    INTO relkind_snake
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'user_branches'
  LIMIT 1;

  has_snake_tbl  := (relkind_snake = 'r');
  has_snake_view := (relkind_snake = 'v' OR relkind_snake = 'm');

  -- Detect camel table
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='UserBranches'
  ) INTO has_camel_tbl;

  -- Choose a physical target table:
  -- 1) If snake is a table, prefer it
  -- 2) Else if camel table exists, use it
  IF has_snake_tbl THEN
    tgt_table := 'user_branches';
  ELSIF has_camel_tbl THEN
    tgt_table := 'UserBranches';
  ELSE
    RAISE NOTICE 'No physical user-branches table found (only a view, or nothing) — skipping.';
    RETURN;
  END IF;

  RAISE NOTICE 'Altering %.% ...', tgt_schema, tgt_table;

  -- Figure out which column names to use on the chosen physical table
  IF tgt_table = 'user_branches' THEN
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema=tgt_schema AND table_name=tgt_table AND column_name='user_id'
    ) INTO has_user;
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema=tgt_schema AND table_name=tgt_table AND column_name='branch_id'
    ) INTO has_branch;
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema=tgt_schema AND table_name=tgt_table AND column_name='tenant_id'
    ) INTO has_tenant;

    -- Drop conflicting unique index if it exists (name may vary across envs)
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'user_branches_user_id_branch_id_key') THEN
      EXECUTE 'DROP INDEX IF EXISTS public.user_branches_user_id_branch_id_key';
    END IF;

    -- Cast to proper types, guarded by existence
    IF has_user THEN
      EXECUTE '
        ALTER TABLE public.user_branches
        ALTER COLUMN user_id TYPE uuid
        USING (CASE WHEN user_id IS NULL THEN NULL ELSE (user_id::text)::uuid END)
      ';
    END IF;

    IF has_branch THEN
      EXECUTE '
        ALTER TABLE public.user_branches
        ALTER COLUMN branch_id TYPE integer
        USING (CASE WHEN branch_id IS NULL THEN NULL ELSE branch_id::integer END)
      ';
    END IF;

    IF has_tenant THEN
      EXECUTE '
        ALTER TABLE public.user_branches
        ALTER COLUMN tenant_id TYPE uuid
        USING (CASE WHEN tenant_id IS NULL THEN NULL ELSE (tenant_id::text)::uuid END)
      ';
    END IF;

    -- Recreate UPSERT/uniqueness index on the physical table
    IF has_user AND has_branch THEN
      EXECUTE '
        CREATE UNIQUE INDEX IF NOT EXISTS user_branches_user_id_branch_id_key
        ON public.user_branches (user_id, branch_id)
      ';
    END IF;

    -- Optional: default for created_at if present
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='user_branches' AND column_name='created_at'
    ) THEN
      EXECUTE 'ALTER TABLE public.user_branches ALTER COLUMN created_at SET DEFAULT NOW()';
    END IF;

  ELSE
    -- Target is the CamelCase physical table "UserBranches"
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema=tgt_schema AND table_name=tgt_table AND column_name='userId'
    ) INTO has_user;
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema=tgt_schema AND table_name=tgt_table AND column_name='branchId'
    ) INTO has_branch;
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema=tgt_schema AND table_name=tgt_table AND column_name='tenantId'
    ) INTO has_tenant;

    -- Cast to proper types, guarded by existence
    IF has_user THEN
      EXECUTE '
        ALTER TABLE public."UserBranches"
        ALTER COLUMN "userId" TYPE uuid
        USING (CASE WHEN "userId" IS NULL THEN NULL ELSE ("userId"::text)::uuid END)
      ';
    END IF;

    IF has_branch THEN
      EXECUTE '
        ALTER TABLE public."UserBranches"
        ALTER COLUMN "branchId" TYPE integer
        USING (CASE WHEN "branchId" IS NULL THEN NULL ELSE "branchId"::integer END)
      ';
    END IF;

    IF has_tenant THEN
      EXECUTE '
        ALTER TABLE public."UserBranches"
        ALTER COLUMN "tenantId" TYPE uuid
        USING (CASE WHEN "tenantId" IS NULL THEN NULL ELSE ("tenantId"::text)::uuid END)
      ';
    END IF;

    -- Recreate uniqueness index (consistent name for camel)
    IF has_user AND has_branch THEN
      EXECUTE '
        CREATE UNIQUE INDEX IF NOT EXISTS "UserBranches_userId_branchId_key"
        ON public."UserBranches" ("userId","branchId")
      ';
    END IF;

    -- Optional: default for createdAt if present
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='UserBranches' AND column_name='createdAt'
    ) THEN
      EXECUTE 'ALTER TABLE public."UserBranches" ALTER COLUMN "createdAt" SET DEFAULT NOW()';
    END IF;
  END IF;

  -- If snake object is a VIEW, leave it intact (no ALTER/INDEX on a view)
  IF has_snake_view THEN
    RAISE NOTICE 'Note: public.user_branches is a VIEW; it was not altered.';
  END IF;

  RAISE NOTICE 'UserBranches alignment completed successfully.';
END
$mig$;
`;
    await queryInterface.sequelize.query(sql);
  },

  down: async () => {
    // Non-destructive: keep aligned types.
  },
};
