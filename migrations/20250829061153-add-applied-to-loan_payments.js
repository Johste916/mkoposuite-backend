// migrations/20250829-add-applied-to-loan_payments.js
'use strict';
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.addColumn('loan_payments', 'applied', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    });
  },
  async down (queryInterface) {
    await queryInterface.removeColumn('loan_payments', 'applied');
  }
};
