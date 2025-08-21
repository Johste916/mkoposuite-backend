// models/loan.js
module.exports = (sequelize, DataTypes) => {
  const Loan = sequelize.define(
    'Loan',
    {
      // Columns exactly as created in your migration (camelCase)
      borrowerId:         { type: DataTypes.INTEGER,  allowNull: false },
      amount:             { type: DataTypes.FLOAT,    allowNull: false },
      interestRate:       { type: DataTypes.FLOAT,    allowNull: false },
      startDate:          { type: DataTypes.DATEONLY, allowNull: false },
      endDate:            { type: DataTypes.DATEONLY, allowNull: false },
      repaymentFrequency: { type: DataTypes.ENUM('weekly', 'monthly'), allowNull: false },
      interestMethod:     { type: DataTypes.ENUM('flat', 'reducing'),  allowNull: false },

      // Keep status aligned to your current enum (no "closed" yet)
      status:             { type: DataTypes.ENUM('pending', 'approved', 'rejected', 'disbursed'), defaultValue: 'pending' },

      approvedBy:         { type: DataTypes.INTEGER },
      approvalDate:       { type: DataTypes.DATE },
      disbursedBy:        { type: DataTypes.INTEGER },
      disbursementDate:   { type: DataTypes.DATE },
      disbursementMethod: { type: DataTypes.STRING },

      // timestamps exist in the table
      createdAt:          { type: DataTypes.DATE },
      updatedAt:          { type: DataTypes.DATE },
    },
    {
      tableName: 'loans',
      timestamps: true,
      underscored: false, // table uses createdAt/updatedAt, not created_at/updated_at
    }
  );

  return Loan;
};
