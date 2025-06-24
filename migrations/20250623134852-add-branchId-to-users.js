'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const table = await queryInterface.describeTable('Users');

    if (!table.branchId) {
      await queryInterface.addColumn('Users', 'branchId', {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Branches', // must match your actual table name
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      });
    } else {
      console.log('✅ Skipped: "branchId" already exists on "Users" table');
    }
  },

  down: async (queryInterface, Sequelize) => {
    const table = await queryInterface.describeTable('Users');

    if (table.branchId) {
      await queryInterface.removeColumn('Users', 'branchId');
    }
  }
};
