module.exports = (sequelize, DataTypes) => {
  const LoanPayment = sequelize.define('LoanPayment', {
    loanId: DataTypes.INTEGER,
    userId: DataTypes.INTEGER,
    amountPaid: DataTypes.DECIMAL,
    paymentDate: DataTypes.DATEONLY
  });

  return LoanPayment;
};
