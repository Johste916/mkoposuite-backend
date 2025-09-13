'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable({ tableName: 'cash_accounts', schema: 'public' }, {
      id:             { type: Sequelize.UUID, allowNull: false, primaryKey: true },
      tenantId:       { type: Sequelize.UUID, allowNull: false },
      name:           { type: Sequelize.STRING(120), allowNull: false },
      branchId:       { type: Sequelize.UUID },
      openingBalance: { type: Sequelize.DECIMAL(18,2), allowNull: false, defaultValue: 0 },
      currentBalance: { type: Sequelize.DECIMAL(18,2), allowNull: false, defaultValue: 0 },
      currency:       { type: Sequelize.STRING(8), defaultValue: 'TZS' },
      isActive:       { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      meta:           { type: Sequelize.JSONB },
      createdAt:      { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updatedAt:      { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });
    await queryInterface.addIndex({ tableName: 'cash_accounts', schema: 'public' }, ['tenantId']);
    await queryInterface.addIndex({ tableName: 'cash_accounts', schema: 'public' }, ['tenantId','name']);
    await queryInterface.addIndex({ tableName: 'cash_accounts', schema: 'public' }, ['branchId']);

    await queryInterface.createTable({ tableName: 'cash_transactions', schema: 'public' }, {
      id:            { type: Sequelize.UUID, allowNull: false, primaryKey: true },
      tenantId:      { type: Sequelize.UUID, allowNull: false },
      cashAccountId: { type: Sequelize.UUID, allowNull: false },
      direction:     { type: Sequelize.STRING(8), allowNull: false },
      type:          { type: Sequelize.STRING(32), allowNull: false },
      amount:        { type: Sequelize.DECIMAL(18,2), allowNull: false },
      currency:      { type: Sequelize.STRING(8) },
      occurredAt:    { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      reference:     { type: Sequelize.STRING(120) },
      description:   { type: Sequelize.TEXT },
      status:        { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'posted' },
      loanId:        { type: Sequelize.UUID },
      borrowerId:    { type: Sequelize.UUID },
      createdBy:     { type: Sequelize.UUID },
      meta:          { type: Sequelize.JSONB },
      createdAt:     { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updatedAt:     { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });

    await queryInterface.addIndex({ tableName: 'cash_transactions', schema: 'public' }, ['tenantId']);
    await queryInterface.addIndex({ tableName: 'cash_transactions', schema: 'public' }, ['cashAccountId']);
    await queryInterface.addIndex({ tableName: 'cash_transactions', schema: 'public' }, ['type']);
    await queryInterface.addIndex({ tableName: 'cash_transactions', schema: 'public' }, ['status']);
    await queryInterface.addIndex({ tableName: 'cash_transactions', schema: 'public' }, ['occurredAt']);
    await queryInterface.addIndex({ tableName: 'cash_transactions', schema: 'public' }, ['loanId']);
    await queryInterface.addIndex({ tableName: 'cash_transactions', schema: 'public' }, ['borrowerId']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable({ tableName: 'cash_transactions', schema: 'public' });
    await queryInterface.dropTable({ tableName: 'cash_accounts', schema: 'public' });
  }
};
