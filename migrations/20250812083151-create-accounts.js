'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (t) => {
      await queryInterface.createTable('Accounts', {
        id:        { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
        code:      { type: Sequelize.STRING(32),  allowNull: false, unique: true },
        name:      { type: Sequelize.STRING(128), allowNull: false },
        // e.g. asset, liability, equity, income, expense, cash, bank
        type:      { type: Sequelize.STRING(32),  allowNull: false },
        parentId:  {
          type: Sequelize.INTEGER,
          allowNull: true,
          references: { model: 'Accounts', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },

        createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      }, { transaction: t });

      await queryInterface.addIndex('Accounts', ['type'],     { transaction: t });
      await queryInterface.addIndex('Accounts', ['parentId'], { transaction: t });
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (t) => {
      await queryInterface.dropTable('Accounts', { transaction: t });
    });
  },
};
