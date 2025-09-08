// server/models/featureFlag.js
'use strict';
module.exports = (sequelize, DataTypes) => {
  const FeatureFlag = sequelize.define('FeatureFlag', {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    tenant_id: { type: DataTypes.UUID, allowNull: false },
    key: { type: DataTypes.STRING, allowNull: false },
    enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  }, { tableName: 'feature_flags', underscored: true, timestamps: true, indexes: [{ unique: true, fields: ['tenant_id','key'] }] });
  return FeatureFlag;
};
