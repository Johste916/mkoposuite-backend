'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable({ tableName: 'bank_transactions', schema: 'public' }, {
      id:          { type: Sequelize.UUID, allowNull: false, primaryKey: true },
      tenantId:    { type: Sequelize.UUID, allowNull: false },
      bankId:      { type: Sequelize.UUID, allowNull: false },
      direction:   { type: Sequelize.STRING(8), allowNull: false }, // in|out
      type:        { type: Sequelize.STRING(32), allowNull: false },
      amount:      { type: Sequelize.DECIMAL(18,2), allowNull: false },
      currency:    { type: Sequelize.STRING(8) },
      occurredAt:  { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      reference:   { type: Sequelize.STRING(120) },
      description: { type: Sequelize.TEXT },
      status:      { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'posted' },
      loanId:      { type: Sequelize.UUID },
      borrowerId:  { type: Sequelize.UUID },
      createdBy:   { type: Sequelize.UUID },
      meta:        { type: Sequelize.JSONB },
      createdAt:   { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updatedAt:   { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });

    await queryInterface.addIndex({ tableName: 'bank_transactions', schema: 'public' }, ['tenantId']);
    await queryInterface.addIndex({ tableName: 'bank_transactions', schema: 'public' }, ['bankId']);
    await queryInterface.addIndex({ tableName: 'bank_transactions', schema: 'public' }, ['type']);
    await queryInterface.addIndex({ tableName: 'bank_transactions', schema: 'public' }, ['status']);
    await queryInterface.addIndex({ tableName: 'bank_transactions', schema: 'public' }, ['occurredAt']);
    await queryInterface.addIndex({ tableName: 'bank_transactions', schema: 'public' }, ['loanId']);
    await queryInterface.addIndex({ tableName: 'bank_transactions', schema: 'public' }, ['borrowerId']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable({ tableName: 'bank_transactions', schema: 'public' });
  }
};
