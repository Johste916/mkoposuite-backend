'use strict';

/**
 * This migration is adaptive:
 * - Works whether your table is public.user_branches or public."UserBranches"
 * - Works whether columns are snake_case (user_id) or camelCase ("userId")
 * - Only alters columns that actually exist (guards with IF EXISTS checks)
 * - Recreates the unique index used by ON CONFLICT (user_id, branch_id)
 */

module.exports = {
  up: async (queryInterface /*, Sequelize */) => {
    const sql = `
DO $mig$
DECLARE
  -- Which physical table exists?
  tbl_snake boolean := EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='user_branches'
  );
  tbl_camel boolean := EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='UserBranches'
  );

  -- Helper to check column presence
  has_col_snake_user  boolean;
  has_col_snake_branch boolean;
  has_col_snake_tenant boolean;

  has_col_camel_user  boolean;
  has_col_camel_branch boolean;
  has_col_camel_tenant boolean;
BEGIN
  IF NOT (tbl_snake OR tbl_camel) THEN
    RAISE NOTICE 'No user_branches/UserBranches table found; skipping migration.';
    RETURN;
  END IF;

  IF tbl_snake THEN
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='user_branches' AND column_name='user_id'
    ) INTO has_col_snake_user;

    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='user_branches' AND column_name='branch_id'
    ) INTO has_col_snake_branch;

    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='user_branches' AND column_name='tenant_id'
    ) INTO has_col_snake_tenant;

    -- Drop conflicting indexes if they exist
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'user_branches_user_id_branch_id_key') THEN
      EXECUTE 'DROP INDEX IF EXISTS public.user_branches_user_id_branch_id_key';
    END IF;

    -- Alter types safely (only when the column exists)
    IF has_col_snake_user THEN
      EXECUTE '
        ALTER TABLE public.user_branches
        ALTER COLUMN user_id TYPE uuid
        USING (CASE WHEN user_id IS NULL THEN NULL ELSE (user_id::text)::uuid END)
      ';
    END IF;

    IF has_col_snake_branch THEN
      EXECUTE '
        ALTER TABLE public.user_branches
        ALTER COLUMN branch_id TYPE integer
        USING (CASE WHEN branch_id IS NULL THEN NULL ELSE branch_id::integer END)
      ';
    END IF;

    IF has_col_snake_tenant THEN
      EXECUTE '
        ALTER TABLE public.user_branches
        ALTER COLUMN tenant_id TYPE uuid
        USING (CASE WHEN tenant_id IS NULL THEN NULL ELSE (tenant_id::text)::uuid END)
      ';
    END IF;

    -- Recreate unique index for UPSERT
    IF has_col_snake_user AND has_col_snake_branch THEN
      EXECUTE '
        CREATE UNIQUE INDEX IF NOT EXISTS user_branches_user_id_branch_id_key
        ON public.user_branches (user_id, branch_id)
      ';
    END IF;

    -- Helpful tenant index
    IF has_col_snake_tenant THEN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_user_branches_tenant ON public.user_branches (tenant_id)';
    END IF;

    -- Ensure created_at default if present
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='user_branches' AND column_name='created_at'
    ) THEN
      EXECUTE 'ALTER TABLE public.user_branches ALTER COLUMN created_at SET DEFAULT NOW()';
    END IF;

  ELSIF tbl_camel THEN
    -- CamelCase + quoted identifiers
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='UserBranches' AND column_name='userId'
    ) INTO has_col_camel_user;

    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='UserBranches' AND column_name='branchId'
    ) INTO has_col_camel_branch;

    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='UserBranches' AND column_name='tenantId'
    ) INTO has_col_camel_tenant;

    -- Drop conflicting indexes if they exist (name likely different; skip if unknown)
    -- Change types
    IF has_col_camel_user THEN
      EXECUTE '
        ALTER TABLE public."UserBranches"
        ALTER COLUMN "userId" TYPE uuid
        USING (CASE WHEN "userId" IS NULL THEN NULL ELSE ("userId"::text)::uuid END)
      ';
    END IF;

    IF has_col_camel_branch THEN
      EXECUTE '
        ALTER TABLE public."UserBranches"
        ALTER COLUMN "branchId" TYPE integer
        USING (CASE WHEN "branchId" IS NULL THEN NULL ELSE "branchId"::integer END)
      ';
    END IF;

    IF has_col_camel_tenant THEN
      EXECUTE '
        ALTER TABLE public."UserBranches"
        ALTER COLUMN "tenantId" TYPE uuid
        USING (CASE WHEN "tenantId" IS NULL THEN NULL ELSE ("tenantId"::text)::uuid END)
      ';
    END IF;

    -- Unique index for UPSERT (name it consistently)
    IF has_col_camel_user AND has_col_camel_branch THEN
      EXECUTE '
        CREATE UNIQUE INDEX IF NOT EXISTS "UserBranches_userId_branchId_key"
        ON public."UserBranches" ("userId","branchId")
      ';
    END IF;

    -- Tenant index
    IF has_col_camel_tenant THEN
      EXECUTE 'CREATE INDEX IF NOT EXISTS "idx_UserBranches_tenant" ON public."UserBranches" ("tenantId")';
    END IF;

    -- createdAt default if present
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='UserBranches' AND column_name='createdAt'
    ) THEN
      EXECUTE 'ALTER TABLE public."UserBranches" ALTER COLUMN "createdAt" SET DEFAULT NOW()';
    END IF;
  END IF;

  RAISE NOTICE 'UserBranches type fix completed.';
END
$mig$;
`;
    await queryInterface.sequelize.query(sql);
  },

  down: async (queryInterface /*, Sequelize */) => {
    // Non-destructive down; we won't force types back to bigint.
    // If you really need a rollback, add symmetrical casts here,
    // but keeping "up" permanent is usually best once aligned.
  },
};
