// migrations/2025xxxxxx-alter-branches-tenantid-to-uuid.js
'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Drop tenant index if it exists (will be recreated)
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_branches_tenant') THEN
          DROP INDEX IF EXISTS public.idx_branches_tenant;
        END IF;
      END$$;
    `);

    // Convert bigint -> uuid (casting via text when possible)
    await queryInterface.sequelize.query(`
      ALTER TABLE public.branches
      ALTER COLUMN tenant_id TYPE uuid
      USING (
        CASE
          WHEN tenant_id IS NULL THEN NULL
          ELSE (tenant_id::text)::uuid
        END
      );
    `);

    // Recreate tenant index on uuid column
    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_branches_tenant
      ON public.branches USING btree (tenant_id);
    `);
  },

  down: async (queryInterface, Sequelize) => {
    // Reverse (uuid -> bigint) if you ever need it
    await queryInterface.sequelize.query(`
      DROP INDEX IF EXISTS public.idx_branches_tenant;
      ALTER TABLE public.branches
      ALTER COLUMN tenant_id TYPE bigint
      USING (NULL); -- can't safely downcast; set NULL or customize if you track mapping
    `);
  },
};
