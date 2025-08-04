// models/loanrepayment.js
module.exports = (sequelize, DataTypes) => {
  const LoanRepayment = sequelize.define('LoanRepayment', {
    loanId: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    installmentNumber: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    dueDate: {
      type: DataTypes.DATE,
      allowNull: false
    },
    principal: {
      type: DataTypes.DECIMAL,
      allowNull: false
    },
    interest: {
      type: DataTypes.DECIMAL,
      allowNull: false
    },
    total: {
      type: DataTypes.DECIMAL,
      allowNull: false
    },
    balance: {
      type: DataTypes.DECIMAL,
      allowNull: false
    },
    status: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'pending'
    }
  });

  return LoanRepayment;
};
