'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = { tableName: 'cash_transactions', schema: 'public' };

    let desc = null;
    try { desc = await queryInterface.describeTable(table); } catch (_) {}

    const ensure = async (col, spec) => {
      if (!desc || !desc[col]) await queryInterface.addColumn(table, col, spec).catch(() => {});
    };

    if (!desc) {
      await queryInterface.createTable(table, {
        id:              { type: Sequelize.UUID, primaryKey: true, allowNull: false },
        tenant_id:       { type: Sequelize.UUID, allowNull: false },
        cash_account_id: { type: Sequelize.UUID, allowNull: false },
        direction:       { type: Sequelize.ENUM('in','out'), allowNull: false },
        type:            { type: Sequelize.STRING(64), allowNull: false, defaultValue: 'other' },
        amount:          { type: Sequelize.DECIMAL(18,2), allowNull: false, defaultValue: 0 },
        currency:        { type: Sequelize.STRING(8), allowNull: false, defaultValue: 'TZS' },
        occurred_at:     { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        status:          { type: Sequelize.STRING(24), allowNull: false, defaultValue: 'posted' },
        reference:       { type: Sequelize.STRING(120), allowNull: true },
        description:     { type: Sequelize.TEXT, allowNull: true },
        loan_id:         { type: Sequelize.UUID, allowNull: true },
        borrower_id:     { type: Sequelize.UUID, allowNull: true },
        created_by:      { type: Sequelize.UUID, allowNull: true },
        meta:            { type: Sequelize.JSONB, allowNull: true },
        createdAt:       { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        updatedAt:       { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      });
      desc = await queryInterface.describeTable(table);
    } else {
      await ensure('tenant_id',       { type: Sequelize.UUID, allowNull: false, defaultValue: '00000000-0000-0000-0000-000000000000' });
      await ensure('cash_account_id', { type: Sequelize.UUID, allowNull: false });
      await ensure('direction',       { type: Sequelize.ENUM('in','out'), allowNull: false });
      await ensure('type',            { type: Sequelize.STRING(64), allowNull: false, defaultValue: 'other' });
      await ensure('amount',          { type: Sequelize.DECIMAL(18,2), allowNull: false, defaultValue: 0 });
      await ensure('currency',        { type: Sequelize.STRING(8), allowNull: false, defaultValue: 'TZS' });
      await ensure('occurred_at',     { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') });
      await ensure('status',          { type: Sequelize.STRING(24), allowNull: false, defaultValue: 'posted' });
      await ensure('reference',       { type: Sequelize.STRING(120), allowNull: true });
      await ensure('description',     { type: Sequelize.TEXT, allowNull: true });
      await ensure('loan_id',         { type: Sequelize.UUID, allowNull: true });
      await ensure('borrower_id',     { type: Sequelize.UUID, allowNull: true });
      await ensure('created_by',      { type: Sequelize.UUID, allowNull: true });
      await ensure('meta',            { type: Sequelize.JSONB, allowNull: true });
      await ensure('createdAt',       { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') });
      await ensure('updatedAt',       { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') });
    }

    const addIdx = async (cols, name) => { try { await queryInterface.addIndex(table, cols, { name }); } catch (_) {} };
    await addIdx(['tenant_id'], 'cash_tx_tenant_id');
    await addIdx(['cash_account_id'], 'cash_tx_cash_account_id');
    await addIdx(['tenant_id', 'status'], 'cash_tx_tenant_id_status');
    await addIdx(['occurred_at'], 'cash_tx_occurred_at');
  },

  async down(queryInterface) {
    const table = { tableName: 'cash_transactions', schema: 'public' };
    const drop = async (name) => { try { await queryInterface.removeIndex(table, name); } catch (_) {} };
    await drop('cash_tx_tenant_id');
    await drop('cash_tx_cash_account_id');
    await drop('cash_tx_tenant_id_status');
    await drop('cash_tx_occurred_at');
    try { await queryInterface.dropTable(table); } catch (_) {}
    try { await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_public_cash_transactions_direction";'); } catch (_) {}
  }
};
