'use strict';
module.exports = (sequelize, DataTypes) => {
  const { Model } = require('sequelize');
  class Plan extends Model {}

  Plan.init({
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    code: { type: DataTypes.STRING(50), unique: true, allowNull: false },
    name: { type: DataTypes.STRING(100), allowNull: false },
    currency: { type: DataTypes.STRING, allowNull: true },
    priceMonthly: { type: DataTypes.DECIMAL(18,2), allowNull: true, field: 'price_monthly' },
    priceYearly:  { type: DataTypes.DECIMAL(18,2), allowNull: true, field: 'price_yearly' },
    features: { type: DataTypes.JSONB, allowNull: true },
    limits:   { type: DataTypes.JSONB, allowNull: true },
    active:   { type: DataTypes.BOOLEAN, defaultValue: true },
  }, {
    sequelize,
    modelName: 'Plan',
    tableName: 'plans',        // ✅ lowercase to match migrations
    underscored: true,
    timestamps: true,
  });

  return Plan;
};
