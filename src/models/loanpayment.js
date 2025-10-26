// src/models/loanPayment.js
'use strict';

module.exports = (sequelize, DataTypes) => {
  const LoanPayment = sequelize.define(
    'LoanPayment',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

      loanId:     { type: DataTypes.INTEGER, allowNull: false, field: 'loanId' },

      // 👇 FIX: your live table doesn’t have amountPaid/amount_paid; it has `amount`
      amountPaid: { type: DataTypes.DECIMAL(14, 2), allowNull: false, field: 'amount' },

      paymentDate:{ type: DataTypes.DATE, allowNull: true, field: 'paymentDate' },
      status:     { type: DataTypes.STRING,  allowNull: true,  field: 'status',  defaultValue: 'approved' },
      applied:    { type: DataTypes.BOOLEAN, allowNull: true,  field: 'applied', defaultValue: true },

      borrowerId: { type: DataTypes.INTEGER, allowNull: true, field: 'borrowerId' },
      productId:  { type: DataTypes.INTEGER, allowNull: true, field: 'productId' },
      officerId:  { type: DataTypes.UUID,    allowNull: true, field: 'officerId' },

      branchId:   { type: DataTypes.INTEGER, allowNull: true, field: 'branch_id' },
      tenantId:   { type: DataTypes.INTEGER, allowNull: true, field: 'tenant_id' },
      userId:     { type: DataTypes.INTEGER, allowNull: true, field: 'user_id' },
    },
    {
      tableName: 'LoanPayment',
      freezeTableName: true,
      timestamps: true,
      underscored: true,
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
