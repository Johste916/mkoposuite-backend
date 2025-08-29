'use strict';
module.exports = (sequelize, DataTypes) => {
  const { Model } = require('sequelize');
  class PayrollItem extends Model {}
  PayrollItem.init(
    {
      tenantId: { type: DataTypes.UUID, allowNull: true, field: 'tenant_id' },
      employeeId: { type: DataTypes.INTEGER, allowNull: false, field: 'employee_id' },
      type: { type: DataTypes.STRING(16), allowNull: false }, // allowance|deduction
      name: { type: DataTypes.STRING(64), allowNull: false },
      amount: { type: DataTypes.DECIMAL(18,2), allowNull: false, defaultValue: 0 },
      taxable: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      recurrence: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'monthly' }, // monthly|oneoff
      startMonth: { type: DataTypes.STRING(7), allowNull: true, field: 'start_month' }, // YYYY-MM
      endMonth:   { type: DataTypes.STRING(7), allowNull: true, field: 'end_month' },
    },
    { sequelize, modelName: 'PayrollItem', tableName: 'PayrollItems',
      indexes: [{ fields: ['tenant_id'] }, { fields: ['employee_id'] }, { fields: ['type'] }] }
  );
  return PayrollItem;
};
