'use strict';
module.exports = (sequelize, DataTypes) => {
  const { Model } = require('sequelize');
  class Contract extends Model {}
  Contract.init(
    {
      tenantId: { type: DataTypes.UUID, allowNull: true, field: 'tenant_id' },
      employeeId: { type: DataTypes.INTEGER, allowNull: false, field: 'employee_id' },
      title: { type: DataTypes.STRING(128), allowNull: true },
      startDate: { type: DataTypes.DATEONLY, allowNull: false, field: 'start_date' },
      endDate:   { type: DataTypes.DATEONLY, allowNull: true, field: 'end_date' },
      salaryBase:{ type: DataTypes.DECIMAL(18,2), allowNull: true, field: 'salary_base' },
      fileUrl:   { type: DataTypes.STRING(255), allowNull: true, field: 'file_url' },
    },
    { sequelize, modelName: 'Contract', tableName: 'Contracts',
      indexes: [{ fields: ['tenant_id'] }, { fields: ['employee_id'] }] }
  );
  return Contract;
};
