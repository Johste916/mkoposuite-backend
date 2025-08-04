// models/loan.js
module.exports = (sequelize, DataTypes) => {
  const Loan = sequelize.define('Loan', {
    borrowerId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    amount: {
      type: DataTypes.FLOAT,
      allowNull: false,
    },
    currency: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'TZS', // e.g., TZS, USD, KES
    },
    interestRate: {
      type: DataTypes.FLOAT,
      allowNull: false,
    },
    startDate: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    endDate: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    repaymentFrequency: {
      type: DataTypes.ENUM('weekly', 'monthly'),
      allowNull: false,
    },
    interestMethod: {
      type: DataTypes.ENUM('flat', 'reducing'),
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM('pending', 'approved', 'rejected', 'disbursed'),
      defaultValue: 'pending',
    },

    // Workflow tracking
    initiatedBy: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    approvedBy: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    approvalDate: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    approvalComments: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    rejectedBy: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    rejectionDate: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    rejectionComments: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    disbursedBy: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    disbursementDate: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    disbursementMethod: {
      type: DataTypes.STRING,
      allowNull: true,
    },

    // Branch tracking
    branchId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
  });

  Loan.associate = (models) => {
    Loan.belongsTo(models.Borrower, { foreignKey: 'borrowerId' });
    Loan.belongsTo(models.Branch, { foreignKey: 'branchId', as: 'branch' });
    Loan.hasMany(models.LoanRepayment, { foreignKey: 'loanId' });
    Loan.belongsTo(models.User, { foreignKey: 'initiatedBy', as: 'initiator' });
    Loan.belongsTo(models.User, { foreignKey: 'approvedBy', as: 'approver' });
    Loan.belongsTo(models.User, { foreignKey: 'rejectedBy', as: 'rejector' });
    Loan.belongsTo(models.User, { foreignKey: 'disbursedBy', as: 'disburser' });
  };

  return Loan;
};
