'use strict';
module.exports = (sequelize, DataTypes) => {
  const { Model } = require('sequelize');
  class Invoice extends Model {}
  Invoice.init({
    companyId: DataTypes.UUID,
    subscriptionId: DataTypes.UUID,
    number: { type: DataTypes.STRING, unique: true },
    currency: DataTypes.STRING,
    amountDue: DataTypes.DECIMAL(18,2),
    amountPaid: DataTypes.DECIMAL(18,2),
    status: DataTypes.ENUM('draft','open','paid','past_due','void'),
    issuedAt: DataTypes.DATE,
    dueAt: DataTypes.DATE,
    metadata: DataTypes.JSONB,
  }, { sequelize, modelName: 'Invoice', tableName: 'Invoices' });
  return Invoice;
};
