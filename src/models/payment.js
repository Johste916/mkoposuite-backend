'use strict';

module.exports = (sequelize, DataTypes) => {
  const { Model } = require('sequelize');

  class Payment extends Model {}

  Payment.init(
    {
      invoiceId:  DataTypes.UUID,
      provider:   DataTypes.STRING,
      providerRef:DataTypes.STRING,
      currency:   DataTypes.STRING,
      amount:     DataTypes.DECIMAL(18, 2),
      status:     DataTypes.ENUM('succeeded', 'pending', 'failed', 'refunded'),
      paidAt:     DataTypes.DATE,
      raw:        DataTypes.JSONB,
    },
    {
      sequelize,
      modelName: 'Payment',
      tableName: 'Payments',
      freezeTableName: true,
      timestamps: true,          // use global camel timestamps
    }
  );

  return Payment;
};
