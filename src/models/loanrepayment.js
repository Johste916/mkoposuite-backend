// models/loanrepayment.js
module.exports = (sequelize, DataTypes) => {
    const LoanRepayment = sequelize.define('LoanRepayment', {
      loanId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      dueDate: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      amountDue: {
        type: DataTypes.FLOAT,
        allowNull: false,
      },
      amountPaid: {
        type: DataTypes.FLOAT,
        defaultValue: 0,
      },
      status: {
        type: DataTypes.STRING,
        defaultValue: 'unpaid',
      }
    });
  
    LoanRepayment.associate = (models) => {
      LoanRepayment.belongsTo(models.Loan, { foreignKey: 'loanId' });
    };
  
    return LoanRepayment;
  };