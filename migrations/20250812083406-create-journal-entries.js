'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (t) => {
      await queryInterface.createTable('JournalEntries', {
        id:        { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
        date:      { type: Sequelize.DATEONLY, allowNull: false },
        memo:      { type: Sequelize.STRING(255), allowNull: true },

        createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      }, { transaction: t });

      await queryInterface.addIndex('JournalEntries', ['date'], { transaction: t });
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (t) => {
      await queryInterface.dropTable('JournalEntries', { transaction: t });
    });
  },
};
