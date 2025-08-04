// migrations/xxxxxx-create-loan-settings.js
'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('LoanSettings', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      defaultInterestRate: {
        type: Sequelize.FLOAT
      },
      defaultLoanTerm: {
        type: Sequelize.INTEGER
      },
      maxLoanAmount: {
        type: Sequelize.FLOAT
      },
      penaltyRate: {
        type: Sequelize.FLOAT
      },
      gracePeriodDays: {
        type: Sequelize.INTEGER
      },
      processingFee: {
        type: Sequelize.FLOAT
      },
      requireCollateral: {
        type: Sequelize.BOOLEAN,
        defaultValue: false
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.fn('NOW')
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.fn('NOW')
      }
    });
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('LoanSettings');
  }
};
