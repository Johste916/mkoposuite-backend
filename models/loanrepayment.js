// backend/models/loanrepayment.js
'use strict';

module.exports = (sequelize, DataTypes) => {
  const LoanRepayment = sequelize.define('LoanRepayment', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    loanId: { type: DataTypes.INTEGER, allowNull: false },
    installmentNumber: { type: DataTypes.INTEGER, allowNull: false },
    dueDate: { type: DataTypes.DATE, allowNull: false },
    principal: { type: DataTypes.DECIMAL(10,2), allowNull: false },
    interest: { type: DataTypes.DECIMAL(10,2), allowNull: false },
    total: { type: DataTypes.DECIMAL(10,2), allowNull: false },
    balance: { type: DataTypes.DECIMAL(10,2), allowNull: false },
    status: {
      type: DataTypes.ENUM('pending','overdue','paid'),
      allowNull: false,
      defaultValue: 'pending'
    }
  }, {
    tableName: 'LoanRepayments'
  });

  LoanRepayment.associate = models => {
    // this alias *must* match your include in the controller
    LoanRepayment.belongsTo(models.Loan, {
      foreignKey: 'loanId',
      as: 'loan'
    });
  };

  return LoanRepayment;
};
