// models/loanpayment.js
module.exports = (sequelize, DataTypes) => {
    const LoanPayment = sequelize.define('LoanPayment', {
      loanId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      paymentDate: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      amountPaid: {
        type: DataTypes.FLOAT,
        allowNull: false,
      },
      method: {
        type: DataTypes.STRING,
        allowNull: true,
      }
    });
  
    LoanPayment.associate = (models) => {
      LoanPayment.belongsTo(models.Loan, { foreignKey: 'loanId' });
    };
  
    return LoanPayment;
  };