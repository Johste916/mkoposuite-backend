// backend/src/models/loan.js
"use strict";

module.exports = (sequelize, DataTypes) => {
  const Loan = sequelize.define(
    "Loan",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },

      // ⚠️ IMPORTANT: DB column is camelCase `borrowerId` (not borrower_id)
      borrowerId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: "borrowerId",
      },

      // These two appear to exist as snake_case in your DB (per logs).
      productId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: "product_id",
      },
      branchId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: "branch_id",
      },

      amount: { type: DataTypes.DECIMAL(18, 2), allowNull: false },
      currency: { type: DataTypes.STRING(10), allowNull: true, defaultValue: "KES" },

      interestRate: { type: DataTypes.DECIMAL(10, 4), allowNull: true, field: "interest_rate" },
      termMonths: { type: DataTypes.INTEGER, allowNull: true, field: "term_months" },
      startDate: { type: DataTypes.DATEONLY, allowNull: true, field: "start_date" },
      endDate: { type: DataTypes.DATEONLY, allowNull: true, field: "end_date" },
      repaymentFrequency: { type: DataTypes.STRING(20), allowNull: true, field: "repayment_frequency" },
      interestMethod: { type: DataTypes.STRING(20), allowNull: true, field: "interest_method" },

      status: { type: DataTypes.STRING(20), allowNull: true },

      initiatedBy: { type: DataTypes.UUID, allowNull: true, field: "initiated_by" },
      approvedBy: { type: DataTypes.UUID, allowNull: true, field: "approved_by" },
      approvalDate: { type: DataTypes.DATE, allowNull: true, field: "approval_date" },
      approvalComments: { type: DataTypes.TEXT, allowNull: true, field: "approval_comments" },

      rejectedBy: { type: DataTypes.UUID, allowNull: true, field: "rejected_by" },
      rejectionDate: { type: DataTypes.DATE, allowNull: true, field: "rejection_date" },
      rejectionComments: { type: DataTypes.TEXT, allowNull: true, field: "rejection_comments" },

      disbursedBy: { type: DataTypes.UUID, allowNull: true, field: "disbursed_by" },
      disbursementDate: { type: DataTypes.DATE, allowNull: true, field: "disbursement_date" },
      disbursementMethod: { type: DataTypes.STRING(50), allowNull: true, field: "disbursement_method" },

      // Optional totals if you have them; harmless if columns are absent (we don’t read/write directly).
      totalInterest: { type: DataTypes.DECIMAL(18, 2), allowNull: true, field: "total_interest" },
      outstanding: { type: DataTypes.DECIMAL(18, 2), allowNull: true, field: "outstanding" },
    },
    {
      tableName: "loans",
      underscored: true, // keeps created_at/updated_at matching your DB
      timestamps: true,
    }
  );

  return Loan;
};
