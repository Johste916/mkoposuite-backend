'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const cashAccounts = { tableName: 'cash_accounts', schema: 'public' };
    const cashTxs      = { tableName: 'cash_transactions', schema: 'public' };

    const caExists = await queryInterface.sequelize.query(
      `SELECT to_regclass('public.cash_accounts') as oid;`,
      { type: Sequelize.QueryTypes.SELECT }
    );
    if (!caExists[0].oid) {
      await queryInterface.createTable(cashAccounts, {
        id:               { type: Sequelize.UUID, allowNull: false, primaryKey: true },
        tenant_id:        { type: Sequelize.UUID, allowNull: false },
        name:             { type: Sequelize.STRING(120), allowNull: false },
        branch_id:        { type: Sequelize.UUID },

        opening_balance:  { type: Sequelize.DECIMAL(18,2), allowNull: false, defaultValue: 0 },
        current_balance:  { type: Sequelize.DECIMAL(18,2), allowNull: false, defaultValue: 0 },
        currency:         { type: Sequelize.STRING(8), allowNull: false, defaultValue: 'TZS' },
        is_active:        { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },

        meta:             { type: Sequelize.JSONB },

        createdAt:        { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        updatedAt:        { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      });

      await queryInterface.addIndex(cashAccounts, ['tenant_id']);
      await queryInterface.addIndex(cashAccounts, ['tenant_id','name']);
      await queryInterface.addIndex(cashAccounts, ['branch_id']);
      await queryInterface.addIndex(cashAccounts, ['is_active']);
    }

    const ctExists = await queryInterface.sequelize.query(
      `SELECT to_regclass('public.cash_transactions') as oid;`,
      { type: Sequelize.QueryTypes.SELECT }
    );
    if (!ctExists[0].oid) {
      await queryInterface.createTable(cashTxs, {
        id:               { type: Sequelize.UUID, allowNull: false, primaryKey: true },
        tenant_id:        { type: Sequelize.UUID, allowNull: false },
        cash_account_id:  { type: Sequelize.UUID, allowNull: false },

        direction:        { type: Sequelize.STRING(8), allowNull: false }, // in|out
        type:             { type: Sequelize.STRING(32), allowNull: false },
        amount:           { type: Sequelize.DECIMAL(18,2), allowNull: false },
        currency:         { type: Sequelize.STRING(8) },

        occurred_at:      { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        reference:        { type: Sequelize.STRING(120) },
        description:      { type: Sequelize.TEXT },
        status:           { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'posted' },

        loan_id:          { type: Sequelize.UUID },
        borrower_id:      { type: Sequelize.UUID },
        created_by:       { type: Sequelize.UUID },

        meta:             { type: Sequelize.JSONB },

        createdAt:        { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        updatedAt:        { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      });

      await queryInterface.addIndex(cashTxs, ['tenant_id']);
      await queryInterface.addIndex(cashTxs, ['cash_account_id']);
      await queryInterface.addIndex(cashTxs, ['type']);
      await queryInterface.addIndex(cashTxs, ['status']);
      await queryInterface.addIndex(cashTxs, ['occurred_at']);
      await queryInterface.addIndex(cashTxs, ['loan_id']);
      await queryInterface.addIndex(cashTxs, ['borrower_id']);
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable({ tableName: 'cash_transactions', schema: 'public' });
    await queryInterface.dropTable({ tableName: 'cash_accounts', schema: 'public' });
  }
};
