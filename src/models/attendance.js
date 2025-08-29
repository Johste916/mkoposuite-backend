'use strict';
module.exports = (sequelize, DataTypes) => {
  const { Model } = require('sequelize');
  class Attendance extends Model {}
  Attendance.init(
    {
      tenantId: { type: DataTypes.UUID, allowNull: true, field: 'tenant_id' },
      employeeId: { type: DataTypes.INTEGER, allowNull: false, field: 'employee_id' },
      date: { type: DataTypes.DATEONLY, allowNull: false },
      checkInTime: { type: DataTypes.STRING(8), allowNull: true, field: 'check_in_time' },
      checkOutTime:{ type: DataTypes.STRING(8), allowNull: true, field: 'check_out_time' },
      hoursWorked: { type: DataTypes.DECIMAL(6,2), allowNull: true, field: 'hours_worked' },
      status: { type: DataTypes.STRING(16), allowNull: true }, // present|absent|leave
      note: { type: DataTypes.STRING(255), allowNull: true },
    },
    {
      sequelize,
      modelName: 'Attendance',
      tableName: 'Attendance',
      indexes: [{ fields: ['tenant_id'] }, { fields: ['employee_id'] }, { fields: ['date'] }],
    }
  );
  return Attendance;
};
