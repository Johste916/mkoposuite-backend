// server/models/tenantLimit.js
'use strict';
module.exports = (sequelize, DataTypes) => {
  const TenantLimit = sequelize.define('TenantLimit', {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    tenant_id: { type: DataTypes.UUID, allowNull: false },
    key: { type: DataTypes.STRING, allowNull: false },
    value_int: { type: DataTypes.INTEGER, allowNull: true },
    value_numeric: { type: DataTypes.DECIMAL, allowNull: true },
    value_text: { type: DataTypes.TEXT, allowNull: true },
    value_json: { type: DataTypes.JSONB, allowNull: true },
  }, { tableName: 'tenant_limits', underscored: true, timestamps: true, indexes: [{ unique: true, fields: ['tenant_id','key'] }] });
  return TenantLimit;
};
