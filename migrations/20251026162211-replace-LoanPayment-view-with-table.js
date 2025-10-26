// 20251026190000-replace-LoanPayment-view-with-table.js
'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.sequelize.transaction(async (t) => {
      // 1) Drop the view if it exists (safe: views hold no data)
      await queryInterface.sequelize.query(
        'DROP VIEW IF EXISTS "public"."LoanPayment";',
        { transaction: t }
      );

      // 2) Create the real table
      await queryInterface.createTable(
        { schema: 'public', tableName: 'LoanPayment' },
        {
          id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
          loanId: { type: Sequelize.INTEGER, allowNull: false },
          amount: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
          paymentDate: { type: Sequelize.DATEONLY, allowNull: true },
          status: { type: Sequelize.STRING, allowNull: false, defaultValue: 'POSTED' },
          applied: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },

          borrowerId: { type: Sequelize.INTEGER, allowNull: true },
          productId: { type: Sequelize.INTEGER, allowNull: true },
          officerId: { type: Sequelize.INTEGER, allowNull: true },

          branch_id: { type: Sequelize.INTEGER, allowNull: true },
          tenant_id: { type: Sequelize.INTEGER, allowNull: true },
          user_id: { type: Sequelize.INTEGER, allowNull: true },

          created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
          updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        },
        { transaction: t }
      );

      // 3) (Optional) Indexes you rely on
      await queryInterface.addIndex({ schema: 'public', tableName: 'LoanPayment' }, ['loanId'], { transaction: t });
      await queryInterface.addIndex({ schema: 'public', tableName: 'LoanPayment' }, ['created_at'], { transaction: t });
    });
  },

  down: async (queryInterface) => {
    await queryInterface.sequelize.transaction(async (t) => {
      await queryInterface.dropTable({ schema: 'public', tableName: 'LoanPayment' }, { transaction: t });
      // If you previously had a view definition, you could recreate it here with CREATE VIEW...
    });
  },
};
