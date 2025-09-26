// src/models/loan.js
module.exports = (sequelize, DataTypes) => {
  const Loan = sequelize.define(
    'Loan',
    {
      // Core FKs (match your existing migration)
      borrowerId: { type: DataTypes.INTEGER, allowNull: false, field: 'borrowerId' },

      // Optional branch (only if your DB actually has this; harmless if unused)
      branchId:   { type: DataTypes.INTEGER, allowNull: true,  field: 'branchId' },

      // product_id in DB → productId in model
      productId:  { type: DataTypes.INTEGER, allowNull: false, field: 'product_id' },

      // Reference used on receipts etc.
      reference:  { type: DataTypes.STRING, unique: true },

      // Money / terms
      amount:       { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      currency:     { type: DataTypes.STRING(8), allowNull: false, defaultValue: 'TZS' },
      interestRate: { type: DataTypes.DECIMAL(10, 4), field: 'interestRate' },

      // term_months in DB → termMonths in model
      termMonths: { type: DataTypes.INTEGER, allowNull: false, field: 'term_months' },

      // CamelCase columns exist in your DB
      startDate:          { type: DataTypes.DATEONLY, allowNull: false, field: 'startDate' },
      endDate:            { type: DataTypes.DATEONLY, allowNull: false, field: 'endDate' },

      repaymentFrequency: {
        type: DataTypes.ENUM('weekly', 'monthly'),
        allowNull: false,
        defaultValue: 'monthly',
        field: 'repaymentFrequency',
      },

      // Your code uses 'flat' and 'reducing'
      interestMethod:     {
        type: DataTypes.ENUM('flat', 'reducing'),
        allowNull: false,
        defaultValue: 'flat',
        field: 'interestMethod',
      },

      // Status enum (persisted values only)
      status: {
        type: DataTypes.ENUM('pending', 'approved', 'rejected', 'disbursed', 'closed'),
        allowNull: false,
        defaultValue: 'pending',
        field: 'status',
      },

      // Numeric totals (snake in DB)
      totalInterest: { type: DataTypes.DECIMAL(14, 2), field: 'total_interest' },
      outstanding:   { type: DataTypes.DECIMAL(14, 2), field: 'outstanding' },

      // Workflow columns (your original migration used INTEGERs, not UUIDs)
      approvedBy:       { type: DataTypes.INTEGER, field: 'approvedBy' },
      approvalDate:     { type: DataTypes.DATE,    field: 'approvalDate' },
      disbursedBy:      { type: DataTypes.INTEGER, field: 'disbursedBy' },
      disbursementDate: { type: DataTypes.DATE,    field: 'disbursementDate' },
      disbursementMethod: { type: DataTypes.STRING, field: 'disbursementMethod' },

      // Close fields (snake in DB)
      closedBy:   { type: DataTypes.INTEGER, field: 'closed_by' },
      closedDate: { type: DataTypes.DATE,    field: 'closed_date' },
    },
    {
      tableName: 'loans',
      timestamps: true,   // createdAt / updatedAt exist in DB
      underscored: false, // many columns are camelCase already
      hooks: {
        // Fill reference if missing
        beforeValidate: async (loan) => {
          if (!loan.reference) {
            const rnd = Math.random().toString(36).slice(2, 8).toUpperCase();
            loan.reference = `LN-${(loan.borrowerId || 'X')}-${rnd}`;
          }
          // Auto-derive endDate if missing but startDate & termMonths exist
          if (!loan.endDate && loan.startDate && loan.termMonths != null) {
            loan.endDate = addMonthsDateOnly(loan.startDate, Number(loan.termMonths));
          }
        },
      },
    }
  );

  // Helper lives here so hooks can use it
  function addMonthsDateOnly(dateStr, months) {
    // dateStr is "YYYY-MM-DD"
    const [y, m, d] = String(dateStr).split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    const targetMonthIndex = dt.getUTCMonth() + months;
    const target = new Date(Date.UTC(dt.getUTCFullYear(), targetMonthIndex, dt.getUTCDate()));
    // Handle end-of-month rollover (e.g., Jan 31 + 1 month)
    if (target.getUTCMonth() !== ((m - 1 + months) % 12 + 12) % 12) {
      target.setUTCDate(0);
    }
    return target.toISOString().slice(0, 10);
  }

  return Loan;
};
