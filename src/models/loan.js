// src/models/loan.js
module.exports = (sequelize, DataTypes) => {
  const Loan = sequelize.define(
    'Loan',
    {
      // Foreign keys
      borrowerId: { type: DataTypes.INTEGER, allowNull: false, field: 'borrowerId' }, // camel in DB
      branchId:   { type: DataTypes.INTEGER, allowNull: true,  field: 'branchId'   }, // camel in DB
      productId:  { type: DataTypes.INTEGER, allowNull: true,  field: 'product_id' }, // snake in DB

      // Amounts / currency
      amount:   { type: DataTypes.DECIMAL(14,2), allowNull: false, defaultValue: 0 },
      currency: { type: DataTypes.STRING(8), defaultValue: 'KES' },

      // Terms (snake_case in DB)
      interestRate:       { type: DataTypes.DECIMAL(10,4), field: 'interest_rate' },
      termMonths:         { type: DataTypes.INTEGER,       field: 'term_months' },
      startDate:          { type: DataTypes.DATEONLY,      field: 'start_date' },
      endDate:            { type: DataTypes.DATEONLY,      field: 'end_date' },
      repaymentFrequency: { type: DataTypes.STRING,        field: 'repayment_frequency' },
      interestMethod:     { type: DataTypes.STRING,        field: 'interest_method' },

      status: { type: DataTypes.STRING },

      totalInterest: { type: DataTypes.DECIMAL(14,2), field: 'total_interest' },
      outstanding:   { type: DataTypes.DECIMAL(14,2) },

      // User traceability (UUIDs; already added in DB)
      initiatedBy: { type: DataTypes.UUID, field: 'initiated_by' },
      approvedBy:  { type: DataTypes.UUID, field: 'approved_by'  },
      rejectedBy:  { type: DataTypes.UUID, field: 'rejected_by'  },
      disbursedBy: { type: DataTypes.UUID, field: 'disbursed_by' },
      closedBy:    { type: DataTypes.UUID, field: 'closed_by'    },

      approvalDate:       { type: DataTypes.DATE, field: 'approval_date' },
      rejectionDate:      { type: DataTypes.DATE, field: 'rejection_date' },
      disbursementDate:   { type: DataTypes.DATE, field: 'disbursement_date' },
      closedDate:         { type: DataTypes.DATE, field: 'closed_date' },

      approvalComments:   { type: DataTypes.TEXT,   field: 'approval_comments' },
      rejectionComments:  { type: DataTypes.TEXT,   field: 'rejection_comments' },
      disbursementMethod: { type: DataTypes.STRING, field: 'disbursement_method' },
      closeReason:        { type: DataTypes.STRING, field: 'close_reason' },
    },
    {
      tableName: 'loans',
      underscored: true, // uses created_at / updated_at
    }
  );

  return Loan;
};
