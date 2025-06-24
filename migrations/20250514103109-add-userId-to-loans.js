'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const table = await queryInterface.describeTable('Users');

    if (!table.password) {
      await queryInterface.addColumn('Users', 'password', {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: '', // prevent null constraint error during migration
      });
    } else {
      console.log('✅ Skipped: "password" already exists on Users table');
    }
  },

  down: async (queryInterface, Sequelize) => {
    const table = await queryInterface.describeTable('Users');

    if (table.password) {
      await queryInterface.removeColumn('Users', 'password');
    } else {
      console.log('ℹ️ Skipped: "password" not found on Users table');
    }
  }
};
