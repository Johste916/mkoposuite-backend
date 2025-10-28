// src/models/LoanPayment.js
'use strict';

module.exports = (sequelize, DataTypes) => {
  const isPg = sequelize.getDialect && sequelize.getDialect() === 'postgres';
  const JSON_TYPE = isPg ? DataTypes.JSONB : DataTypes.JSON;

  const LoanPayment = sequelize.define(
    'LoanPayment',
    {
      id:        { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

      // FKs
      loanId:    { type: DataTypes.INTEGER, allowNull: false, field: 'loanId' },
      userId:    { type: DataTypes.UUID,    allowNull: true,  field: 'userId' },      // Users.id is UUID
      officerId: { type: DataTypes.UUID,    allowNull: true,  field: 'officerId' },   // optional (constraints: false)

      // Core
      amountPaid: {
        type: DataTypes.DECIMAL(14, 2),
        allowNull: false,
        defaultValue: 0,
        field: 'amountPaid',
      },
      paymentDate: { type: DataTypes.DATEONLY, allowNull: false, field: 'paymentDate' },

      // Meta
      method:     { type: DataTypes.STRING,   allowNull: true,  field: 'method' },
      notes:      { type: DataTypes.TEXT,     allowNull: true,  field: 'notes' },
      status:     {
        type: DataTypes.STRING(16),
        allowNull: false,
        defaultValue: 'approved',
        validate: { isIn: [['pending', 'approved', 'rejected', 'voided']] },
        field: 'status',
      },
      applied:    { type: DataTypes.BOOLEAN,  allowNull: false, defaultValue: true,   field: 'applied' },
      reference:  { type: DataTypes.STRING,   allowNull: true,  field: 'reference' },
      receiptNo:  { type: DataTypes.STRING,   allowNull: true,  field: 'receiptNo' },
      currency:   { type: DataTypes.STRING(8),allowNull: true,  field: 'currency' },

      gateway:    { type: DataTypes.STRING,   allowNull: true,  field: 'gateway' },
      gatewayRef: { type: DataTypes.STRING,   allowNull: true,  field: 'gatewayRef' },

      allocation: { type: JSON_TYPE,          allowNull: true,  field: 'allocation' },
      voidReason: { type: DataTypes.TEXT,     allowNull: true,  field: 'voidReason' },
    },
    {
      tableName: 'loan_payments',  // ✅ single canonical table
      freezeTableName: true,
      timestamps: true,            // createdAt/updatedAt (camel), matching your codebase
      underscored: false,          // camel columns
      defaultScope: {
        order: [
          ['paymentDate', 'DESC'],
          ['createdAt', 'DESC'],
        ],
      },
      indexes: [
        { fields: ['loanId'] },
        { fields: ['userId'] },
        { fields: ['officerId'] },
        { fields: ['paymentDate'] },
        { fields: ['status'] },
        { fields: ['reference'] },
        { fields: ['gatewayRef'] },
        { fields: ['createdAt'] },
      ],
    }
  );

  LoanPayment.associate = (models) => {
    if (models.Loan && !LoanPayment.associations?.Loan) {
      LoanPayment.belongsTo(models.Loan, { foreignKey: 'loanId', as: 'Loan' });
    }
    if (models.User) {
      if (!LoanPayment.associations?.User) {
        LoanPayment.belongsTo(models.User, { foreignKey: 'userId', as: 'User', constraints: false });
      }
      if (!LoanPayment.associations?.Officer) {
        LoanPayment.belongsTo(models.User, { foreignKey: 'officerId', as: 'Officer', constraints: false });
      }
    }
  };

  return LoanPayment;
};
