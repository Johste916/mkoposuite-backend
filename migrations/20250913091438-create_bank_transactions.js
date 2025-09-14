'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = { tableName: 'bank_transactions', schema: 'public' };
    const exists = await queryInterface.sequelize.query(
      `SELECT to_regclass('public.bank_transactions') as oid;`,
      { type: Sequelize.QueryTypes.SELECT }
    );

    if (!exists[0].oid) {
      await queryInterface.createTable(table, {
        id:           { type: Sequelize.UUID, allowNull: false, primaryKey: true },
        tenant_id:    { type: Sequelize.UUID, allowNull: false },
        bank_id:      { type: Sequelize.UUID, allowNull: false },

        direction:    { type: Sequelize.STRING(8), allowNull: false }, // in|out
        type:         { type: Sequelize.STRING(32), allowNull: false },
        amount:       { type: Sequelize.DECIMAL(18,2), allowNull: false },
        currency:     { type: Sequelize.STRING(8) },

        occurred_at:  { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        reference:    { type: Sequelize.STRING(120) },
        description:  { type: Sequelize.TEXT },
        status:       { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'posted' },

        // Reconcile fields could be created here or in a later migration
        bank_ref:     { type: Sequelize.STRING(120) },
        note:         { type: Sequelize.TEXT },
        reconciled:   { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
        reconciled_at:{ type: Sequelize.DATE },
        reconciled_by:{ type: Sequelize.UUID },

        loan_id:      { type: Sequelize.UUID },
        borrower_id:  { type: Sequelize.UUID },
        created_by:   { type: Sequelize.UUID },

        meta:         { type: Sequelize.JSONB },

        createdAt:    { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        updatedAt:    { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      });

      await queryInterface.addIndex(table, ['tenant_id']);
      await queryInterface.addIndex(table, ['bank_id']);
      await queryInterface.addIndex(table, ['type']);
      await queryInterface.addIndex(table, ['status']);
      await queryInterface.addIndex(table, ['occurred_at']);
      await queryInterface.addIndex(table, ['loan_id']);
      await queryInterface.addIndex(table, ['borrower_id']);
      await queryInterface.addIndex(table, ['reconciled']);
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable({ tableName: 'bank_transactions', schema: 'public' });
  }
};
