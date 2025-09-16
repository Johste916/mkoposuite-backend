'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const qi = queryInterface;
    const sql = (s) => qi.sequelize.query(s);

    // Ensure runtime table exists (idempotent)
    await qi.createTable('user_branches_rt', {
      user_id:   { type: Sequelize.UUID,    allowNull: false },
      branch_id: { type: Sequelize.INTEGER, allowNull: false },
      created_at:{ type: Sequelize.DATE,    allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at:{ type: Sequelize.DATE,    allowNull: false, defaultValue: Sequelize.fn('NOW') },
    }).catch(() => { /* already exists */ });

    // 1) Enforce single-branch per user
    await qi.addIndex('user_branches_rt', {
      fields: ['user_id'],
      name: 'ux_user_branches_rt_user_single',
      unique: true,
    }).catch(() => { /* already present */ });

    await qi.addIndex('user_branches_rt', {
      fields: ['branch_id'],
      name: 'ix_user_branches_rt_branch',
      unique: false,
    }).catch(() => {});

    // 2) Ensure read view exists and points to RT table
    await sql(`
      CREATE OR REPLACE VIEW public.user_branches AS
      SELECT ubr.user_id, ubr.branch_id, ubr.created_at
      FROM public.user_branches_rt AS ubr;
    `);

    // 3) Borrowers: enforce single-branch per borrower (if table exists, make it unique)
    await sql(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema='public' AND table_name='borrower_branches'
        ) THEN
          -- add created_at if missing
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema='public' AND table_name='borrower_branches' AND column_name='created_at'
          ) THEN
            ALTER TABLE public.borrower_branches ADD COLUMN created_at timestamptz DEFAULT now();
          END IF;

          -- unique on borrower
          IF NOT EXISTS (
            SELECT 1 FROM pg_indexes
            WHERE schemaname='public' AND indexname='ux_borrower_branches_borrower_single'
          ) THEN
            CREATE UNIQUE INDEX ux_borrower_branches_borrower_single
              ON public.borrower_branches (borrower_id);
          END IF;

          -- helpful lookup index
          IF NOT EXISTS (
            SELECT 1 FROM pg_indexes
            WHERE schemaname='public' AND indexname='ix_borrower_branches_branch'
          ) THEN
            CREATE INDEX ix_borrower_branches_branch ON public.borrower_branches (branch_id);
          END IF;
        END IF;
      END$$;
    `);
  },

  down: async (queryInterface) => {
    const qi = queryInterface;
    const sql = (s) => qi.sequelize.query(s);

    await qi.removeIndex('user_branches_rt', 'ux_user_branches_rt_user_single').catch(() => {});
    await qi.removeIndex('user_branches_rt', 'ix_user_branches_rt_branch').catch(() => {});
    await sql(`DROP VIEW IF EXISTS public.user_branches;`).catch(() => {});
    // Do not drop borrower indexes in down() to avoid breaking existing data unexpectedly.
  },
};
