'use strict';
module.exports = {
  up: async (queryInterface, Sequelize) => {
    // only drop if it exists
    const tableDef = await queryInterface.describeTable('Loans');
    if (tableDef.termMonths) {
      await queryInterface.removeColumn('Loans', 'termMonths');
      console.log('✔ termMonths column dropped');
    } else {
      console.log('→ termMonths not found, skipping');
    }
  },
  down: async (queryInterface, Sequelize) => {
    // restore it if you ever roll back
    const tableDef = await queryInterface.describeTable('Loans');
    if (!tableDef.termMonths) {
      await queryInterface.addColumn('Loans', 'termMonths', {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      });
      console.log('– termMonths column restored');
    }
  }
};
