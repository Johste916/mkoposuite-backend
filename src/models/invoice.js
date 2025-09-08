// server/models/invoice.js
'use strict';
module.exports = (sequelize, DataTypes) => {
  const Invoice = sequelize.define('Invoice', {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    tenant_id: { type: DataTypes.UUID, allowNull: false },
    number: { type: DataTypes.STRING, allowNull: false, unique: true },
    amount_cents: { type: DataTypes.INTEGER, allowNull: false },
    currency: { type: DataTypes.STRING, allowNull: false, defaultValue: 'USD' },
    status: { type: DataTypes.ENUM('open','unpaid','past_due','paid','void','draft'), allowNull: false, defaultValue: 'open' },
    due_date: { type: DataTypes.DATEONLY, allowNull: true },
    issued_at: { type: DataTypes.DATE, allowNull: true },
    paid_at: { type: DataTypes.DATE, allowNull: true },
    pdf_url: { type: DataTypes.TEXT, allowNull: true },
  }, { tableName: 'invoices', underscored: true, timestamps: true });

  Invoice.associate = (models) => {
    Invoice.belongsTo(models.Tenant, { foreignKey: 'tenant_id' });
  };
  return Invoice;
};
