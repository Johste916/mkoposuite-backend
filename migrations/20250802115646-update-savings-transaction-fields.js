'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // Extend the enum to include 'charge' and 'interest'
    await queryInterface.changeColumn('SavingsTransactions', 'type', {
      type: Sequelize.ENUM('deposit', 'withdrawal', 'charge', 'interest'),
      allowNull: false,
    });

    // Add the 'reversed' column
    await queryInterface.addColumn('SavingsTransactions', 'reversed', {
      type: Sequelize.BOOLEAN,
      defaultValue: false,
    });
  },

  async down(queryInterface, Sequelize) {
    // Revert 'type' column to old enum
    await queryInterface.changeColumn('SavingsTransactions', 'type', {
      type: Sequelize.ENUM('deposit', 'withdrawal'),
      allowNull: false,
    });

    // Remove the 'reversed' column
    await queryInterface.removeColumn('SavingsTransactions', 'reversed');
  },
};
