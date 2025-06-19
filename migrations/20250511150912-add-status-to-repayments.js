'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('LoanRepayments', 'status', {
      type: Sequelize.STRING,
      allowNull: false,
      defaultValue: 'pending' // possible: pending, paid, overdue
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('LoanRepayments', 'status');
  }
};
