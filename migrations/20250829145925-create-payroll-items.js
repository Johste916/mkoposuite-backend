'use strict';
module.exports = {
  async up(qi, Sequelize) {
    await qi.createTable('PayrollItems', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      tenant_id: { type: Sequelize.UUID, allowNull: true },
      employee_id:{ type: Sequelize.INTEGER, allowNull: false, references: { model: 'Employees', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE' },
      type: { type: Sequelize.STRING(16), allowNull: false },
      name: { type: Sequelize.STRING(64), allowNull: false },
      amount: { type: Sequelize.DECIMAL(18,2), allowNull: false, defaultValue: 0 },
      taxable: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      recurrence: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'monthly' },
      start_month:{ type: Sequelize.STRING(7), allowNull: true },
      end_month:  { type: Sequelize.STRING(7), allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });
    await qi.addIndex('PayrollItems', ['tenant_id']);
    await qi.addIndex('PayrollItems', ['employee_id']);
  },
  async down(qi) { await qi.dropTable('PayrollItems'); },
};
