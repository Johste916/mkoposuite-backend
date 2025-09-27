// models/loanpayment.js
module.exports = (sequelize, DataTypes) => {
  const LoanPayment = sequelize.define(
    'LoanPayment',
    {
      loanId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      userId: {
        type: DataTypes.UUID,        // must match Users.id (UUID) in most setups
        allowNull: true,             // allow null for imports/system jobs
      },
      amountPaid: {
        type: DataTypes.DECIMAL(14, 2),
        allowNull: false,
        defaultValue: 0,
      },
      paymentDate: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      method: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      // ⚠ If your physical table is *exactly* loan_payments, keep this.
      // If your DB uses "LoanPayments" (Sequelize default), remove tableName.
      tableName: 'loan_payments',
      timestamps: true,
      indexes: [
        { fields: ['loanId'] },
        { fields: ['userId'] },
        { fields: ['paymentDate'] },
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
