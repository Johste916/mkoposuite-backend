'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // First, get the current columns on Loans
    const tableDef = await queryInterface.describeTable('Loans');

    // Only add `term` if missing
    if (!tableDef.term) {
      await queryInterface.addColumn('Loans', 'term', {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      });
      console.log('✔ term column created');
    } else {
      console.log('→ term column already exists, skipping');
    }

    // Only add `interestRate` if missing
    if (!tableDef.interestRate) {
      await queryInterface.addColumn('Loans', 'interestRate', {
        type: Sequelize.DECIMAL(5, 2),
        allowNull: false,
        defaultValue: 0.0,
      });
      console.log('✔ interestRate column created');
    } else {
      console.log('→ interestRate column already exists, skipping');
    }
  },

  down: async (queryInterface, Sequelize) => {
    // You can mirror the checks here if you want, but usually you can just remove:
    const tableDef = await queryInterface.describeTable('Loans');

    if (tableDef.term) {
      await queryInterface.removeColumn('Loans', 'term');
      console.log('– term column removed');
    }
    if (tableDef.interestRate) {
      await queryInterface.removeColumn('Loans', 'interestRate');
      console.log('– interestRate column removed');
    }
  }
};
