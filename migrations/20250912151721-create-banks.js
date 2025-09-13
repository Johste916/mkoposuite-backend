'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable({ tableName: 'banks', schema: 'public' }, {
      id:            { type: Sequelize.UUID, allowNull: false, primaryKey: true },
      tenantId:      { type: Sequelize.UUID, allowNull: false },
      name:          { type: Sequelize.STRING(120), allowNull: false },
      code:          { type: Sequelize.STRING(32) },
      branch:        { type: Sequelize.STRING(120) },
      accountName:   { type: Sequelize.STRING(160) },
      accountNumber: { type: Sequelize.STRING(64) },
      swift:         { type: Sequelize.STRING(64) },
      phone:         { type: Sequelize.STRING(64) },
      address:       { type: Sequelize.TEXT },
      currency:      { type: Sequelize.STRING(8), defaultValue: 'TZS' },
      openingBalance:{ type: Sequelize.DECIMAL(18,2), allowNull: false, defaultValue: 0 },
      currentBalance:{ type: Sequelize.DECIMAL(18,2), allowNull: false, defaultValue: 0 },
      isActive:      { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      meta:          { type: Sequelize.JSONB },
      createdAt:     { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updatedAt:     { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });

    await queryInterface.addIndex({ tableName: 'banks', schema: 'public' }, ['tenantId']);
    await queryInterface.addIndex({ tableName: 'banks', schema: 'public' }, ['tenantId','name']);
    await queryInterface.addIndex({ tableName: 'banks', schema: 'public' }, ['tenantId','accountNumber']);
    await queryInterface.addIndex({ tableName: 'banks', schema: 'public' }, ['isActive']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable({ tableName: 'banks', schema: 'public' });
  }
};
