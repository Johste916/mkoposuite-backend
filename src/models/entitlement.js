'use strict';
module.exports = (sequelize, DataTypes) => {
  const Entitlement = sequelize.define('Entitlement', {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    key: { type: DataTypes.STRING(120), allowNull: false, unique: true },
    label: { type: DataTypes.STRING(160), allowNull: true }
  }, {
    tableName: 'entitlements',
    underscored: true
  });

  Entitlement.associate = (models) => {
    Entitlement.belongsToMany(models.Plan, {
      through: models.PlanEntitlement,
      foreignKey: 'entitlement_id',
      otherKey: 'plan_id',
      as: 'plans'
    });
  };

  return Entitlement;
};
