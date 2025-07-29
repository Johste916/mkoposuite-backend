module.exports = (sequelize, DataTypes) => {
  const Loan = sequelize.define('Loan', {
    amount: DataTypes.FLOAT,
    interestRate: DataTypes.FLOAT,
    termMonths: DataTypes.INTEGER,
    borrowerId: DataTypes.INTEGER,
    status: { type: DataTypes.STRING, defaultValue: 'pending' }, // pending, approved, disbursed, etc.
    startDate: DataTypes.DATEONLY,
  });

  Loan.associate = (models) => {
    Loan.belongsTo(models.Borrower, { foreignKey: 'borrowerId' });
  };

  return Loan;
};
