// migrations/XXXXXXXXXX-alter-branches-and-user-branches.js
'use strict';

module.exports = {
  up: async (qi, Sequelize) => {
    // branches: ensure columns exist and types are correct
    // code must be STRING (not INTEGER) so "001" works
    await qi.changeColumn('branches', 'code', { type: Sequelize.STRING, allowNull: false });

    // add columns if missing (no-op if they already exist on some DBs that support IF NOT EXISTS)
    try { await qi.addColumn('branches', 'phone',    { type: Sequelize.STRING, allowNull: true }); } catch {}
    try { await qi.addColumn('branches', 'address',  { type: Sequelize.TEXT,   allowNull: true }); } catch {}
    try { await qi.addColumn('branches', 'tenant_id',{ type: Sequelize.UUID,   allowNull: true }); } catch {}
    try { await qi.addColumn('branches', 'deletedAt',{ type: Sequelize.DATE,   allowNull: true }); } catch {}

    // optional indexes (wrapped so re-running doesn't explode)
    try { await qi.addIndex('branches', ['tenant_id']); } catch {}
    try { await qi.addIndex('branches', ['code']); } catch {}

    // standardize user_branches naming
    try { await qi.renameTable('UserBranches', 'user_branches'); } catch {}
    // add unique constraint (safe if not present)
    try {
      await qi.addConstraint('user_branches', {
        fields: ['user_id', 'branch_id'],
        type: 'unique',
        name: 'user_branches_user_branch_unique',
      });
    } catch {}
  },

  down: async (qi) => {
    // keep down empty or only include safe reversals
    // (generally you don't want to drop columns in prod on down)
  },
};
