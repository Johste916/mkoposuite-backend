'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Check if column already exists
    const table = await queryInterface.describeTable('Loans');

    if (!table.userId) {
      await queryInterface.addColumn('Loans', 'userId', {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'Users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      });
    } else {
      console.log('✅ Skipped: "userId" column already exists on "Loans" table');
    }
  },

  down: async (queryInterface, Sequelize) => {
    const table = await queryInterface.describeTable('Loans');

    if (table.userId) {
      await queryInterface.removeColumn('Loans', 'userId');
    } else {
      console.log('ℹ️ Skipped: "userId" column not found on "Loans" table');
    }
  }
};
