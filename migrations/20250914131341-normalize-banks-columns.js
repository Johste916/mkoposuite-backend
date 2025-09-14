'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = { tableName: 'banks', schema: 'public' };
    let desc;
    try {
      desc = await queryInterface.describeTable(table);
    } catch { return; }

    // Helper to rename if source exists and target does not
    const maybeRename = async (from, to) => {
      if (desc[from] && !desc[to]) {
        await queryInterface.renameColumn(table, from, to);
      }
    };

    // Common camelCase → snake_case fixes
    await maybeRename('tenantId', 'tenant_id');
    await maybeRename('accountName', 'account_name');
    await maybeRename('accountNumber', 'account_number');
    await maybeRename('openingBalance', 'opening_balance');
    await maybeRename('currentBalance', 'current_balance');
    await maybeRename('isActive', 'is_active');

    // Refresh describe for re-entrant runs
    // (Not strictly necessary—kept simple)
  },

  async down() {
    // No-op: we don’t want to flip back to camelCase.
  }
};
