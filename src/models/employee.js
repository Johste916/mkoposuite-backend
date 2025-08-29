'use strict';
module.exports = (sequelize, DataTypes) => {
  const { Model } = require('sequelize');
  class Employee extends Model {}
  Employee.init(
    {
      tenantId: { type: DataTypes.UUID, allowNull: true, field: 'tenant_id' },
      branchId: { type: DataTypes.INTEGER, allowNull: true },
      firstName:{ type: DataTypes.STRING(64), allowNull: false, field: 'first_name' },
      lastName: { type: DataTypes.STRING(64), allowNull: false, field: 'last_name' },
      email:    { type: DataTypes.STRING(128), allowNull: true, unique: true, validate: { isEmail: true } },
      phone:    { type: DataTypes.STRING(32), allowNull: true },
      position: { type: DataTypes.STRING(64), allowNull: true },
      hireDate: { type: DataTypes.DATEONLY, allowNull: true, field: 'hire_date' },
      status:   { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'active' }, // active|inactive
      salaryBase: { type: DataTypes.DECIMAL(18,2), allowNull: false, defaultValue: 0, field: 'salary_base' },
      bankName:   { type: DataTypes.STRING(64), allowNull: true, field: 'bank_name' },
      bankAccount:{ type: DataTypes.STRING(64), allowNull: true, field: 'bank_account' },
      nhifNo:     { type: DataTypes.STRING(64), allowNull: true, field: 'nhif_no' },
      nssfNo:     { type: DataTypes.STRING(64), allowNull: true, field: 'nssf_no' },
      tinNo:      { type: DataTypes.STRING(64), allowNull: true, field: 'tin_no' },
    },
    {
      sequelize,
      modelName: 'Employee',
      tableName: 'Employees',
      indexes: [{ fields: ['tenant_id'] }, { fields: ['status'] }, { fields: ['branchId'] }],
    }
  );
  return Employee;
};
