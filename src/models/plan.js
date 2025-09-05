'use strict';
module.exports = (sequelize, DataTypes) => {
  const { Model } = require('sequelize');

  class Plan extends Model {
    // relations are defined in models/index.js (guarded)
  }

  Plan.init({
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    code: { type: DataTypes.STRING(50), unique: true, allowNull: false },
    name: { type: DataTypes.STRING(100), allowNull: false },
    // Optional commercial fields; safe if columns don't exist (we won't write them)
    currency: { type: DataTypes.STRING, allowNull: true },
    priceMonthly: { type: DataTypes.DECIMAL(18,2), allowNull: true, field: 'price_monthly' },
    priceYearly: { type: DataTypes.DECIMAL(18,2), allowNull: true, field: 'price_yearly' },
    features: { type: DataTypes.JSONB, allowNull: true },
    limits: { type: DataTypes.JSONB, allowNull: true },
    active: { type: DataTypes.BOOLEAN, defaultValue: true },
  }, {
    sequelize,
    modelName: 'Plan',
    tableName: 'plans',         // ✅ aligns with migrations/seeders
    underscored: true,          // created_at / updated_at
    timestamps: true,
  });

  return Plan;
};
