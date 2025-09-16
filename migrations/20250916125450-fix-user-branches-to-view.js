// migrations/20250916150000-fix-user-branches-to-view.js
'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const qi = queryInterface;
    const sql = (s) => qi.sequelize.query(s);

    // 1. If user_branches is still a table, rename it aside (just in case)
    await sql(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema='public' AND table_name='user_branches'
        ) THEN
          ALTER TABLE public.user_branches RENAME TO user_branches_old;
        END IF;
      END$$;
    `);

    // 2. Ensure runtime table exists
    await qi.createTable('user_branches_rt', {
      user_id:   { type: Sequelize.UUID, allowNull: false },
      branch_id: { type: Sequelize.INTEGER, allowNull: false },
      created_at:{ type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    }).catch(() => {}); // ignore if already exists

    await qi.addConstraint('user_branches_rt', {
      type: 'primary key',
      fields: ['user_id','branch_id'],
      name: 'user_branches_rt_pkey',
    }).catch(() => {});

    // 3. Create the view
    await sql(`
      CREATE OR REPLACE VIEW public.user_branches AS
      SELECT ubr.user_id, ubr.branch_id, ubr.created_at
      FROM public.user_branches_rt AS ubr;
    `);
  },

  down: async (queryInterface) => {
    const qi = queryInterface;
    const sql = (s) => qi.sequelize.query(s);

    await sql(`DROP VIEW IF EXISTS public.user_branches;`);
    await qi.dropTable('user_branches_rt').catch(() => {});
    // restore old table if you want
    await sql(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema='public' AND table_name='user_branches_old'
        ) THEN
          ALTER TABLE public.user_branches_old RENAME TO user_branches;
        END IF;
      END$$;
    `);
  }
};
