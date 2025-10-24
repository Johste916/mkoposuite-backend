'use strict';

module.exports = (sequelize, DataTypes) => {
  // Your DB has both "LoanPayment" (capitalized) and "loan_payments" in some envs.
  // Pick the one you actually use in prod; default here is lowercase table.
  const LoanPayment = sequelize.define(
    'LoanPayment',
    {
      id:         { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

      loanId:     { type: DataTypes.INTEGER, allowNull: false, field: 'loanId' }, // camel exists; if not, set to 'loan_id'
      // If your active table is snake_case only, switch the field to 'loan_id'
      // loanId:     { type: DataTypes.INTEGER, allowNull: false, field: 'loan_id' },

      amountPaid: { type: DataTypes.DECIMAL(14, 2), allowNull: false, field: 'amountPaid' },
      // If snake_case only:
      // amountPaid: { type: DataTypes.DECIMAL(14, 2), allowNull: false, field: 'amount' },

      paymentDate: { type: DataTypes.DATE, allowNull: true, field: 'paymentDate' },
      // Snake-case alternatives you might need:
      // paymentDate: { type: DataTypes.DATE, allowNull: true, field: 'payment_date' },
      // Or fallback commonly seen: 'date' or 'created_at'

      status:     { type: DataTypes.STRING, allowNull: true,  field: 'status', defaultValue: 'approved' },
      applied:    { type: DataTypes.BOOLEAN, allowNull: true, field: 'applied', defaultValue: true },

      borrowerId: { type: DataTypes.INTEGER, allowNull: true, field: 'borrowerId' }, // if present
      productId:  { type: DataTypes.INTEGER, allowNull: true, field: 'productId' },  // if present
      officerId:  { type: DataTypes.UUID,    allowNull: true, field: 'officerId' },  // sometimes user_id
      branchId:   { type: DataTypes.INTEGER, allowNull: true, field: 'branch_id' },  // common in PG

      tenantId:   { type: DataTypes.INTEGER, allowNull: true, field: 'tenant_id' },
    },
    {
      // choose the live table name you actually use:
      tableName: 'LoanPayment',      // if you use the capitalized table
      // tableName: 'loan_payments', // if you use the snake_case table
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
