'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (t) => {
      // describeTable can take a schema option; ensure public for Render
      const desc = await queryInterface.describeTable({ tableName: 'banks', schema: 'public' });
      if (!desc.currency) {
        await queryInterface.addColumn(
          { tableName: 'banks', schema: 'public' },
          'currency',
          {
            type: Sequelize.STRING(8),
            allowNull: false,
            defaultValue: 'TZS',
          },
          { transaction: t }
        );
      }
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (t) => {
      const desc = await queryInterface.describeTable({ tableName: 'banks', schema: 'public' });
      if (desc.currency) {
        await queryInterface.removeColumn({ tableName: 'banks', schema: 'public' }, 'currency', { transaction: t });
      }
    });
  },
};
