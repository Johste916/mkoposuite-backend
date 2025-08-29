'use strict';
module.exports = (sequelize, DataTypes) => {
  const { Model } = require('sequelize');
  class Payrun extends Model {}
  Payrun.init(
    {
      tenantId: { type: DataTypes.UUID, allowNull: true, field: 'tenant_id' },
      period: { type: DataTypes.STRING(7), allowNull: false }, // YYYY-MM
      status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'draft' }, // draft|approved|paid
      runDate:{ type: DataTypes.DATE, allowNull: true, field: 'run_date' },
      notes:  { type: DataTypes.STRING(255), allowNull: true },
    },
    { sequelize, modelName: 'Payrun', tableName: 'Payruns', indexes: [{ fields: ['tenant_id'] }, { fields: ['period'] }] }
  );
  return Payrun;
};
