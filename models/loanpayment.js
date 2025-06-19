// models/loanpayment.js
'use strict';
module.exports = (sequelize, DataTypes) => {
  const LoanPayment = sequelize.define('LoanPayment', {
    loanId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    amountPaid: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
    },
    paymentDate: {
      type: DataTypes.DATE,
      allowNull: false,
    }
  }, {
    tableName: 'LoanPayments',
    timestamps: true,
  });

  LoanPayment.associate = function(models) {
    LoanPayment.belongsTo(models.Loan, { foreignKey: 'loanId' });
  };

  return LoanPayment;
};
