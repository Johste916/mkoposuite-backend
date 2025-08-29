'use strict';
module.exports = (sequelize, DataTypes) => {
  const { Model } = require('sequelize');
  class LeaveRequest extends Model {}
  LeaveRequest.init(
    {
      tenantId: { type: DataTypes.UUID, allowNull: true, field: 'tenant_id' },
      employeeId: { type: DataTypes.INTEGER, allowNull: false, field: 'employee_id' },
      type: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'annual' }, // annual|sick|unpaid
      startDate: { type: DataTypes.DATEONLY, allowNull: false, field: 'start_date' },
      endDate:   { type: DataTypes.DATEONLY, allowNull: false, field: 'end_date' },
      days:      { type: DataTypes.DECIMAL(5,2), allowNull: true },
      status:    { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'pending' }, // pending|approved|rejected
      reason:    { type: DataTypes.STRING(255), allowNull: true },
    },
    { sequelize, modelName: 'LeaveRequest', tableName: 'LeaveRequests',
      indexes: [{ fields: ['tenant_id'] }, { fields: ['employee_id'] }, { fields: ['status'] }] }
  );
  return LeaveRequest;
};
