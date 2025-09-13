'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (t) => {
      // Only add if missing (safe for multiple envs)
      const desc = await queryInterface.describeTable('banks');
      if (!desc.currency) {
        await queryInterface.addColumn(
          'banks',
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

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (t) => {
      const desc = await queryInterface.describeTable('banks');
      if (desc.currency) {
        await queryInterface.removeColumn('banks', 'currency', { transaction: t });
      }
    });
  },
};
