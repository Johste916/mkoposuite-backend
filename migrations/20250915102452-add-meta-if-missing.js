'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const addIfMissing = async (table) => {
      let desc = null;
      try { desc = await queryInterface.describeTable(table); } catch (_) { return; }
      if (!desc.meta) {
        await queryInterface.addColumn(table, 'meta', { type: Sequelize.JSONB, allowNull: true });
      }
    };

    await addIfMissing({ tableName: 'banks',             schema: 'public' });
    await addIfMissing({ tableName: 'bank_transactions',  schema: 'public' });
    await addIfMissing({ tableName: 'cash_transactions',  schema: 'public' });
    // If you also store extra info on cash accounts:
    await (async () => {
      let desc = null;
      try { desc = await queryInterface.describeTable({ tableName: 'cash_accounts', schema: 'public' }); } catch (_) {}
      if (desc && !desc.meta) {
        await queryInterface.addColumn({ tableName: 'cash_accounts', schema: 'public' }, 'meta', { type: Sequelize.JSONB, allowNull: true });
      }
    })();
  },

  async down(queryInterface) {
    // Non-destructive down: keep meta; no-op
  }
};
