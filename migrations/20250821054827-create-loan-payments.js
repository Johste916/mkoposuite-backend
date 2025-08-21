// NEW migration: migrations/20230801_000200-create-loan-payments.js
// ✅ Creates the "loan_payments" table to match models/loanpayment.js
//    and fix "relation loan_payments does not exist" errors.

'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = 'loan_payments';

    const tables = await queryInterface.showAllTables();
    // Handle case-sensitive / schema-qualified names
    const exists = tables.map(t => (typeof t === 'object' ? t.tableName : t))
                         .some(t => String(t).toLowerCase() === table);

    if (!exists) {
      await queryInterface.createTable(table, {
        id: {
          type: Sequelize.INTEGER,
          autoIncrement: true,
          primaryKey: true,
          allowNull: false,
        },
        loanId: {
          type: Sequelize.INTEGER,
          allowNull: false,
          references: { model: 'loans', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        userId: {
          type: Sequelize.UUID, // matches model + Users.id (UUID)
          allowNull: true,
          references: { model: 'Users', key: 'id' }, // Sequelize default table name for User
          onUpdate: 'SET NULL',
          onDelete: 'SET NULL',
        },
        amountPaid: {
          type: Sequelize.DECIMAL(14, 2),
          allowNull: false,
          defaultValue: 0,
        },
        paymentDate: {
          type: Sequelize.DATEONLY,
          allowNull: false,
        },
        method: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        notes: {
          type: Sequelize.TEXT,
          allowNull: true,
        },
        createdAt: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.fn('NOW'),
        },
        updatedAt: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.fn('NOW'),
        },
      });

      await queryInterface.addIndex(table, ['loanId']);
      await queryInterface.addIndex(table, ['userId']);
      await queryInterface.addIndex(table, ['paymentDate']);
    }
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('loan_payments');
  },
};
