'use strict';
module.exports = {
  async up(qi, Sequelize) {
    await qi.createTable('Payslips', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      tenant_id: { type: Sequelize.UUID, allowNull: true },
      payrun_id: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'Payruns', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE' },
      employee_id:{ type: Sequelize.INTEGER, allowNull: false, references: { model: 'Employees', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE' },
      base_salary:     { type: Sequelize.DECIMAL(18,2), allowNull: false, defaultValue: 0 },
      total_allowance: { type: Sequelize.DECIMAL(18,2), allowNull: false, defaultValue: 0 },
      total_deduction: { type: Sequelize.DECIMAL(18,2), allowNull: false, defaultValue: 0 },
      taxable_income:  { type: Sequelize.DECIMAL(18,2), allowNull: false, defaultValue: 0 },
      tax:             { type: Sequelize.DECIMAL(18,2), allowNull: false, defaultValue: 0 },
      gross:           { type: Sequelize.DECIMAL(18,2), allowNull: false, defaultValue: 0 },
      net_pay:         { type: Sequelize.DECIMAL(18,2), allowNull: false, defaultValue: 0 },
      status:          { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'unpaid' },
      payment_date:    { type: Sequelize.DATE, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });
    await qi.addIndex('Payslips', ['tenant_id']);
    await qi.addIndex('Payslips', ['payrun_id']);
    await qi.addIndex('Payslips', ['employee_id']);
  },
  async down(qi) { await qi.dropTable('Payslips'); },
};
