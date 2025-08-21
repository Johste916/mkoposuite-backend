// src/models/loanpayment.js
module.exports = (sequelize, DataTypes) => {
  const LoanPayment = sequelize.define(
    'LoanPayment',
    {
      loanId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      userId: {
        type: DataTypes.UUID,     // should match Users.id (UUID)
        allowNull: true,
      },

      // amounts/dates
      amountPaid: {
        type: DataTypes.DECIMAL(14, 2),
        allowNull: false,
        defaultValue: 0,
      },
      paymentDate: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },

      // meta
      method: { type: DataTypes.STRING, allowNull: true }, // 'cash','mobile','bank', etc
      notes:  { type: DataTypes.TEXT,   allowNull: true },

      // NEW: workflow + external/gateway
      status:     { type: DataTypes.ENUM('pending','approved','rejected','voided'), defaultValue: 'approved' },
      applied:    { type: DataTypes.BOOLEAN, defaultValue: true }, // true if totals/schedule already updated
      reference:  { type: DataTypes.STRING, allowNull: true },     // payer ref / internal ref
      receiptNo:  { type: DataTypes.STRING, allowNull: true },
      currency:   { type: DataTypes.STRING(8), allowNull: true },

      gateway:    { type: DataTypes.STRING, allowNull: true },     // 'mpesa','tigo','bank-xyz', etc
      gatewayRef: { type: DataTypes.STRING, allowNull: true },     // provider txn id

      allocation: { type: DataTypes.JSONB, allowNull: true },      // optional allocation lines
      voidReason: { type: DataTypes.TEXT, allowNull: true },
    },
    {
      tableName: 'loan_payments',
      timestamps: true,
      indexes: [
        { fields: ['loanId'] },
        { fields: ['userId'] },
        { fields: ['paymentDate'] },
        { fields: ['status'] },
        { fields: ['reference'] },
        { fields: ['gatewayRef'] },
      ],
    }
  );

  LoanPayment.associate = (models) => {
    if (models.Loan) {
      LoanPayment.belongsTo(models.Loan, { foreignKey: 'loanId' });
    }
    if (models.User) {
      LoanPayment.belongsTo(models.User, { foreignKey: 'userId' });
    }
  };

  return LoanPayment;
};
