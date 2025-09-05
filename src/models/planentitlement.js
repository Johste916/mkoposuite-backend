'use strict';
module.exports = (sequelize, DataTypes) => {
  const PlanEntitlement = sequelize.define('PlanEntitlement', {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    plan_id: { type: DataTypes.UUID, allowNull: false },
    entitlement_id: { type: DataTypes.UUID, allowNull: false }
  }, {
    tableName: 'plan_entitlements',
    underscored: true
  });

  PlanEntitlement.associate = (/* models */) => {};
  return PlanEntitlement;
};
