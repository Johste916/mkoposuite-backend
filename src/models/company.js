'use strict';
module.exports = (sequelize, DataTypes) => {
  const { Model } = require('sequelize');
  class Company extends Model {}
  Company.init({
    name: DataTypes.STRING,
    slug: { type: DataTypes.STRING, unique: true },
    status: DataTypes.ENUM('trialing','active','past_due','suspended','canceled'),
    trialEndsAt: DataTypes.DATE,
    graceDays: { type: DataTypes.INTEGER, defaultValue: 7 },
    billingEmail: DataTypes.STRING,
    phone: DataTypes.STRING,
    country: DataTypes.STRING,
    currency: DataTypes.STRING,
    planId: DataTypes.UUID,
    metadata: DataTypes.JSONB,
    suspendedAt: DataTypes.DATE,
    canceledAt: DataTypes.DATE,
  }, { sequelize, modelName: 'Company', tableName: 'Companies' });
  return Company;
};
