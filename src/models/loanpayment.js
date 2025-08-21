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
        type: DataTypes.UUID,        // matches Users.id type (UUID)
        allowNull: true,
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
