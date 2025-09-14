'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (t) => {
      const table = { tableName: 'banks', schema: 'public' };
      const desc = await queryInterface.describeTable(table);
      if (!desc.currency) {
        await queryInterface.addColumn(
          table,
          'currency',
          { type: Sequelize.STRING(8), allowNull: false, defaultValue: 'TZS' },
          { transaction: t }
        );
      }
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (t) => {
      const table = { tableName: 'banks', schema: 'public' };
      const desc = await queryInterface.describeTable(table);
      if (desc.currency) {
        await queryInterface.removeColumn(table, 'currency', { transaction: t });
      }
    });
  },
};
