'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const table = await queryInterface.describeTable('Users');

    if (!table.password) {
      await queryInterface.addColumn('Users', 'password', {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'changeme' // temporary default to satisfy NOT NULL constraint
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
      console.log('ℹ️ Skipped: "password" column not found on Users table');
    }
  }
};
