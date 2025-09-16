'use strict';

module.exports = {
  up: async (qi, Sequelize) => {
    // ---- branches ----
    // tenant_id: bigint -> uuid
    // We need USING to coerce; if existing values aren't valid UUIDs, cast will yield NULL.
    await qi.sequelize.query(`
      ALTER TABLE public.branches
      ALTER COLUMN tenant_id DROP DEFAULT,
      ALTER COLUMN tenant_id TYPE uuid
      USING NULLIF(tenant_id::text, '')::uuid
    `);

    // Optional: align types with model (harmless if already correct)
    try { await qi.changeColumn('branches', 'code',   { type: Sequelize.STRING, allowNull: false }); } catch {}
    try { await qi.changeColumn('branches', 'phone',  { type: Sequelize.STRING, allowNull: true  }); } catch {}
    try { await qi.changeColumn('branches', 'address',{ type: Sequelize.TEXT,   allowNull: true  }); } catch {}

    // Optional: helpful indexes
    try { await qi.addIndex('branches', ['tenant_id'], { concurrently: true, name: 'branches_tenant_id_idx' }); } catch {}

    // ---- user_branches (if you use it) ----
    // Make sure tenant_id can hold UUID too.
    try {
      await qi.sequelize.query(`
        ALTER TABLE public.user_branches
        ALTER COLUMN tenant_id DROP DEFAULT,
        ALTER COLUMN tenant_id TYPE uuid
        USING NULLIF(tenant_id::text, '')::uuid
      `);
    } catch {}

    // Enforce uniqueness of (user_id, branch_id) to prevent dup assignments (safe if exists)
    try {
      await qi.addConstraint('user_branches', {
        fields: ['user_id', 'branch_id'],
        type: 'unique',
        name: 'user_branches_user_branch_unique',
      });
    } catch {}
  },

  down: async (qi /*, Sequelize */) => {
    // We usually avoid narrowing back to bigint in down.
    // If you must, uncomment below — it will stringify UUIDs, then try to cast:
    // await qi.sequelize.query(`
    //   ALTER TABLE public.branches
    //   ALTER COLUMN tenant_id TYPE bigint
    //   USING NULLIF(translate(tenant_id::text, '-', ''), '')::bigint
    // `);
    // Same for user_branches if needed.
  },
};
