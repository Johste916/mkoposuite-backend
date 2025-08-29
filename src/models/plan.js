'use strict';
module.exports = (sequelize, DataTypes) => {
  const { Model } = require('sequelize');
  class Plan extends Model {}
  Plan.init({
    code: { type: DataTypes.STRING, unique: true },
    name: DataTypes.STRING,
    currency: DataTypes.STRING,
    priceMonthly: DataTypes.DECIMAL(18,2),
    priceYearly: DataTypes.DECIMAL(18,2),
    features: DataTypes.JSONB,
    limits: DataTypes.JSONB,
    active: { type: DataTypes.BOOLEAN, defaultValue: true },
  }, { sequelize, modelName: 'Plan', tableName: 'Plans' });
  return Plan;
};
