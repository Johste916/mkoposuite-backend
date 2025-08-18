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
        type: DataTypes.UUID,        // 👈 was INTEGER; must match Users.id (UUID)
        allowNull: true,             // allow null if you sometimes record system imports
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
      // optional metadata
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
      tableName: 'loan_payments',     // 👈 set if this is your real table name; otherwise remove
      timestamps: true,
      // underscored: true,           // enable only if physical table uses snake_case timestamps
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
