'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (t) => {
      await queryInterface.createTable(
        { tableName: 'Accounts', schema: 'public' },
        {
          id:        { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
          code:      { type: Sequelize.STRING(32),  allowNull: false, unique: true },
          name:      { type: Sequelize.STRING(128), allowNull: false },
          // asset | liability | equity | income | expense | cash | bank
          type:      { type: Sequelize.STRING(32),  allowNull: false },
          parentId:  {
            type: Sequelize.INTEGER,
            allowNull: true,
            references: { model: { tableName: 'Accounts', schema: 'public' }, key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'SET NULL',
          },

          createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
          updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
        },
        { transaction: t }
      );

      await queryInterface.addIndex({ tableName: 'Accounts', schema: 'public' }, ['code'],     { unique: true, transaction: t });
      await queryInterface.addIndex({ tableName: 'Accounts', schema: 'public' }, ['type'],     { transaction: t });
      await queryInterface.addIndex({ tableName: 'Accounts', schema: 'public' }, ['parentId'], { transaction: t });
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (t) => {
      await queryInterface.dropTable({ tableName: 'Accounts', schema: 'public' }, { transaction: t });
    });
  },
};
