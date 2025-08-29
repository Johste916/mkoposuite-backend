'use strict';
module.exports = (sequelize, DataTypes) => {
  const { Model } = require('sequelize');
  class Payslip extends Model {}
  Payslip.init(
    {
      tenantId: { type: DataTypes.UUID, allowNull: true, field: 'tenant_id' },
      payrunId: { type: DataTypes.INTEGER, allowNull: false, field: 'payrun_id' },
      employeeId: { type: DataTypes.INTEGER, allowNull: false, field: 'employee_id' },
      baseSalary: { type: DataTypes.DECIMAL(18,2), allowNull: false, defaultValue: 0, field: 'base_salary' },
      totalAllowance: { type: DataTypes.DECIMAL(18,2), allowNull: false, defaultValue: 0, field: 'total_allowance' },
      totalDeduction: { type: DataTypes.DECIMAL(18,2), allowNull: false, defaultValue: 0, field: 'total_deduction' },
      taxableIncome:  { type: DataTypes.DECIMAL(18,2), allowNull: false, defaultValue: 0, field: 'taxable_income' },
      tax:            { type: DataTypes.DECIMAL(18,2), allowNull: false, defaultValue: 0 },
      gross:          { type: DataTypes.DECIMAL(18,2), allowNull: false, defaultValue: 0 },
      netPay:         { type: DataTypes.DECIMAL(18,2), allowNull: false, defaultValue: 0, field: 'net_pay' },
      status:         { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'unpaid' }, // unpaid|paid
      paymentDate:    { type: DataTypes.DATE, allowNull: true, field: 'payment_date' },
    },
    { sequelize, modelName: 'Payslip', tableName: 'Payslips',
      indexes: [{ fields: ['tenant_id'] }, { fields: ['payrun_id'] }, { fields: ['employee_id'] }] }
  );
  return Payslip;
};
