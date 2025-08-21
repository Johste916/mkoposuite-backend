'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // Add repayment workflow/metadata fields to loan_payments
    await queryInterface.addColumn('loan_payments', 'status', {
      type: Sequelize.ENUM('pending','approved','rejected','voided'),
      defaultValue: 'approved',
      allowNull: false,
    });
    await queryInterface.addColumn('loan_payments', 'applied', {
      type: Sequelize.BOOLEAN,
      defaultValue: true,
    });
    await queryInterface.addColumn('loan_payments', 'reference', {
      type: Sequelize.STRING,
      allowNull: true,
    });
    await queryInterface.addColumn('loan_payments', 'receiptNo', {
      type: Sequelize.STRING,
      allowNull: true,
    });
    await queryInterface.addColumn('loan_payments', 'currency', {
      type: Sequelize.STRING(8),
      allowNull: true,
    });
    await queryInterface.addColumn('loan_payments', 'gateway', {
      type: Sequelize.STRING,
      allowNull: true,
    });
    await queryInterface.addColumn('loan_payments', 'gatewayRef', {
      type: Sequelize.STRING,
      allowNull: true,
    });
    await queryInterface.addColumn('loan_payments', 'allocation', {
      type: Sequelize.JSONB, // JSONB for Postgres
      allowNull: true,
    });
    await queryInterface.addColumn('loan_payments', 'voidReason', {
      type: Sequelize.TEXT,
      allowNull: true,
    });

    await queryInterface.addIndex('loan_payments', ['status']);
    await queryInterface.addIndex('loan_payments', ['reference']);
    await queryInterface.addIndex('loan_payments', ['gatewayRef']);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeIndex('loan_payments', ['gatewayRef']).catch(()=>{});
    await queryInterface.removeIndex('loan_payments', ['reference']).catch(()=>{});
    await queryInterface.removeIndex('loan_payments', ['status']).catch(()=>{});
    await queryInterface.removeColumn('loan_payments', 'voidReason');
    await queryInterface.removeColumn('loan_payments', 'allocation');
    await queryInterface.removeColumn('loan_payments', 'gatewayRef');
    await queryInterface.removeColumn('loan_payments', 'gateway');
    await queryInterface.removeColumn('loan_payments', 'currency');
    await queryInterface.removeColumn('loan_payments', 'receiptNo');
    await queryInterface.removeColumn('loan_payments', 'reference');
    await queryInterface.removeColumn('loan_payments', 'applied');
    await queryInterface.removeColumn('loan_payments', 'status');

    // drop ENUM in PG to avoid type leftovers
    if (queryInterface.sequelize.getDialect() === 'postgres') {
      await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_loan_payments_status";');
    }
  },
};
