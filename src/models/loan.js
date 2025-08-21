// models/loan.js
module.exports = (sequelize, DataTypes) => {
  // Keep this aligned with your migration which created camelCase columns
  const Loan = sequelize.define(
    'Loan',
    {
      // FKs (add only those that truly exist in DB)
      borrowerId: { type: DataTypes.INTEGER, allowNull: false },
      branchId:   { type: DataTypes.INTEGER, allowNull: true },   // optional (exists only if you migrated it)
      // Map to snake_case DB column:
      productId:  { type: DataTypes.INTEGER, allowNull: true, field: 'product_id' }, // ✅ fixes productId error

      // money / terms
      amount:             { type: DataTypes.FLOAT,    allowNull: false },
      interestRate:       { type: DataTypes.FLOAT,    allowNull: false },
      startDate:          { type: DataTypes.DATEONLY, allowNull: false },
      endDate:            { type: DataTypes.DATEONLY, allowNull: false },
      repaymentFrequency: { type: DataTypes.ENUM('weekly', 'monthly'), allowNull: false },
      interestMethod:     { type: DataTypes.ENUM('flat', 'reducing'),  allowNull: false },

      // status enum as per your migration (no "closed" unless you extend enum)
      status:             { type: DataTypes.ENUM('pending', 'approved', 'rejected', 'disbursed'), defaultValue: 'pending' },

      // workflow/user links (match migration)
      approvedBy:         { type: DataTypes.INTEGER },
      approvalDate:       { type: DataTypes.DATE },
      disbursedBy:        { type: DataTypes.INTEGER },
      disbursementDate:   { type: DataTypes.DATE },
      disbursementMethod: { type: DataTypes.STRING },

      // createdAt / updatedAt come from timestamps
    },
    {
      tableName: 'loans',
      timestamps: true,
      underscored: false, // your migration used createdAt/updatedAt (camelCase)
    }
  );
  return Loan;
};
