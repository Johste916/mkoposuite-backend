// src/models/loanPayment.js
'use strict';

module.exports = (sequelize, DataTypes) => {
  // Live table in your logs is "LoanPayment" (capitalized)
  const LoanPayment = sequelize.define(
    'LoanPayment',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

      // keep these as you had them (your DB has mixed casing for some cols)
      loanId:     { type: DataTypes.INTEGER, allowNull: false, field: 'loanId' },
      // 👇 FIX: DB column is snake_case; map it to the camelCase attribute
      amountPaid: { type: DataTypes.DECIMAL(14, 2), allowNull: false, field: 'amount_paid' },

      paymentDate:{ type: DataTypes.DATE, allowNull: true, field: 'paymentDate' },

      status:     { type: DataTypes.STRING,  allowNull: true,  field: 'status',  defaultValue: 'approved' },
      applied:    { type: DataTypes.BOOLEAN, allowNull: true,  field: 'applied', defaultValue: true },

      borrowerId: { type: DataTypes.INTEGER, allowNull: true, field: 'borrowerId' },
      productId:  { type: DataTypes.INTEGER, allowNull: true, field: 'productId' },
      officerId:  { type: DataTypes.UUID,    allowNull: true, field: 'officerId' },

      // these two were already correct in your logs
      branchId:   { type: DataTypes.INTEGER, allowNull: true, field: 'branch_id' },
      tenantId:   { type: DataTypes.INTEGER, allowNull: true, field: 'tenant_id' },

      // present in your earlier logs, harmless if not used
      userId:     { type: DataTypes.INTEGER, allowNull: true, field: 'user_id' },
    },
    {
      tableName: 'LoanPayment',
      freezeTableName: true,
      timestamps: true,
      underscored: true,           // createdAt/updatedAt -> created_at/updated_at
      // keep existing index column names as-is to avoid any change in behavior
      indexes: [
        { fields: ['loanId'] },
        { fields: ['status'] },
        { fields: ['paymentDate'] },
        { fields: ['branch_id'] },
        { fields: ['tenant_id'] },
      ],
    }
  );

  LoanPayment.associate = (models) => {
    if (models.Loan && !LoanPayment.associations?.Loan) {
      LoanPayment.belongsTo(models.Loan, { as: 'Loan', foreignKey: 'loanId', targetKey: 'id' });
    }
    if (models.Borrower && !LoanPayment.associations?.Borrower) {
      LoanPayment.belongsTo(models.Borrower, { as: 'Borrower', foreignKey: 'borrowerId', targetKey: 'id', constraints: false });
    }
    if (models.User && !LoanPayment.associations?.Officer) {
      LoanPayment.belongsTo(models.User, { as: 'Officer', foreignKey: 'officerId', targetKey: 'id', constraints: false });
    }
  };

  return LoanPayment;
};
