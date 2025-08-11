// models/loan.js
module.exports = (sequelize, DataTypes) => {
  const Loan = sequelize.define(
    'Loan',
    {
      borrowerId: { type: DataTypes.INTEGER, allowNull: false },
      productId:  { type: DataTypes.INTEGER, allowNull: true },
      branchId:   { type: DataTypes.INTEGER, allowNull: true },

      amount:       { type: DataTypes.DECIMAL(14, 2), allowNull: false },
      currency:     { type: DataTypes.STRING, allowNull: false, defaultValue: 'TZS' },
      interestRate: { type: DataTypes.DECIMAL(10, 4), allowNull: false },

      termMonths: { type: DataTypes.INTEGER, allowNull: true },

      startDate: { type: DataTypes.DATEONLY, allowNull: false },
      endDate:   { type: DataTypes.DATEONLY, allowNull: true },

      repaymentFrequency: {
        type: DataTypes.ENUM('weekly', 'monthly'),
        allowNull: false,
        defaultValue: 'monthly',
      },

      interestMethod: {
        type: DataTypes.ENUM('flat', 'reducing'),
        allowNull: false,
        defaultValue: 'flat',
      },

      status: {
        type: DataTypes.ENUM('pending', 'approved', 'rejected', 'disbursed', 'active', 'closed'),
        defaultValue: 'pending',
      },

      initiatedBy:        { type: DataTypes.INTEGER, allowNull: true },
      approvedBy:         { type: DataTypes.INTEGER, allowNull: true },
      approvalDate:       { type: DataTypes.DATE,     allowNull: true },
      approvalComments:   { type: DataTypes.TEXT,     allowNull: true },
      rejectedBy:         { type: DataTypes.INTEGER,  allowNull: true },
      rejectionDate:      { type: DataTypes.DATE,     allowNull: true },
      rejectionComments:  { type: DataTypes.TEXT,     allowNull: true },
      disbursedBy:        { type: DataTypes.INTEGER,  allowNull: true },
      disbursementDate:   { type: DataTypes.DATE,     allowNull: true },
      disbursementMethod: { type: DataTypes.STRING,   allowNull: true },
    },
    {
      tableName: 'loans',
      underscored: true,
      timestamps: true,
      indexes: [
        { fields: ['borrower_id'] },
        { fields: ['product_id'] },
        { fields: ['branch_id'] },
        { fields: ['status'] },
      ],
    }
  );

  Loan.associate = (models) => {
    Loan.belongsTo(models.Borrower, { foreignKey: 'borrowerId' });
    Loan.belongsTo(models.Branch,   { foreignKey: 'branchId', as: 'branch' });

    Loan.hasMany(models.LoanRepayment, { foreignKey: 'loanId' });

    Loan.belongsTo(models.User, { foreignKey: 'initiatedBy', as: 'initiator' });
    Loan.belongsTo(models.User, { foreignKey: 'approvedBy',  as: 'approver' });
    Loan.belongsTo(models.User, { foreignKey: 'rejectedBy',  as: 'rejector' });
    Loan.belongsTo(models.User, { foreignKey: 'disbursedBy', as: 'disburser' });

    if (models.LoanProduct) {
      Loan.belongsTo(models.LoanProduct, { foreignKey: 'productId', as: 'product' });
    }
  };

  return Loan;
};
