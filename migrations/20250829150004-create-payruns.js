'use strict';
module.exports = {
  async up(qi, Sequelize) {
    await qi.createTable('Payruns', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      tenant_id: { type: Sequelize.UUID, allowNull: true },
      period: { type: Sequelize.STRING(7), allowNull: false },
      status: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'draft' },
      run_date:{ type: Sequelize.DATE, allowNull: true },
      notes:   { type: Sequelize.STRING(255), allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });
    await qi.addIndex('Payruns', ['tenant_id']);
    await qi.addIndex('Payruns', ['period']);
  },
  async down(qi) { await qi.dropTable('Payruns'); },
};
