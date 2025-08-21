// migrations/20230801_000001-create-loans.js
// ⛳️ This is your original file, left largely intact.
// If this migration already ran in prod, DO NOT re-run it.
// Instead, apply the new "alter enum" migration below.

'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('loans', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      borrowerId: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      amount: {
        type: Sequelize.FLOAT,
        allowNull: false,
      },
      interestRate: {
        type: Sequelize.FLOAT,
        allowNull: false,
      },
      startDate: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      endDate: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      repaymentFrequency: {
        type: Sequelize.ENUM('weekly', 'monthly'),
        allowNull: false,
      },
      interestMethod: {
        type: Sequelize.ENUM('flat', 'reducing'),
        allowNull: false,
      },
      // NOTE: original enum (missing 'active', 'closed').
      // Keep this as-is if it has already been applied.
      // We'll extend it safely in a separate migration.
      status: {
        type: Sequelize.ENUM('pending', 'approved', 'rejected', 'disbursed'),
        defaultValue: 'pending',
      },
      approvedBy: Sequelize.INTEGER,
      approvalDate: Sequelize.DATE,
      disbursedBy: Sequelize.INTEGER,
      disbursementDate: Sequelize.DATE,
      disbursementMethod: Sequelize.STRING,
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
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('loans');
  },
};
