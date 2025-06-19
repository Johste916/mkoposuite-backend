// models/loan.js
'use strict';
module.exports = (sequelize, DataTypes) => {
  const Loan = sequelize.define('Loan', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    branchId: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false
    },
    term: {                       // number of installments
      type: DataTypes.INTEGER,
      allowNull: false
    },
    interestRate: {               // e.g. 12.50%
      type: DataTypes.DECIMAL(5, 2),
      allowNull: false
    },
    status: {
      type: DataTypes.ENUM('pending','approved','disbursed','repaid','overdue'),
      allowNull: false,
      defaultValue: 'pending'
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    },
    updatedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    }
  }, {
    tableName: 'Loans'
  });

  Loan.associate = function(models) {
    // A Loan belongs to the User who created it
    Loan.belongsTo(models.User, {
      foreignKey: 'userId',
      as: 'user'
    });
    // A Loan belongs to a Branch
    Loan.belongsTo(models.Branch, {
      foreignKey: 'branchId',
      as: 'branch'
    });
    // A Loan has many repayment records
    Loan.hasMany(models.LoanRepayment, {
      foreignKey: 'loanId',
      as: 'repayments',
      onDelete: 'CASCADE'
    });
  };

  return Loan;
};
