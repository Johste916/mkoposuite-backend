'use strict';
module.exports = (sequelize, DataTypes) => {
  const { Model } = require('sequelize');
  class Subscription extends Model {}
  Subscription.init({
    companyId: DataTypes.UUID,
    planId: DataTypes.UUID,
    status: DataTypes.ENUM('trialing','active','past_due','canceled'),
    billingInterval: DataTypes.ENUM('monthly','yearly'),
    autoRenew: { type: DataTypes.BOOLEAN, defaultValue: true },
    currentPeriodStart: DataTypes.DATE,
    currentPeriodEnd: DataTypes.DATE,
    cancelAt: DataTypes.DATE,
    canceledAt: DataTypes.DATE,
  }, { sequelize, modelName: 'Subscription', tableName: 'Subscriptions' });
  return Subscription;
};
