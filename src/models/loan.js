// models/loan.js
module.exports = (sequelize, DataTypes) => {
  // Keep this model aligned with your migration that created camelCase columns
  // (interestRate, startDate, endDate, repaymentFrequency, interestMethod, etc.)
  const Loan = sequelize.define(
    'Loan',
    {
      borrowerId:         { type: DataTypes.INTEGER,  allowNull: false },

      // Optional columns: only add if they truly exist in DB
      branchId:           { type: DataTypes.INTEGER,  allowNull: true  }, // present only if you added it via migration
      productId:          { type: DataTypes.INTEGER,  allowNull: true  }, // add only if you created this column

      amount:             { type: DataTypes.FLOAT,    allowNull: false },
      interestRate:       { type: DataTypes.FLOAT,    allowNull: false },
      startDate:          { type: DataTypes.DATEONLY, allowNull: false },
      endDate:            { type: DataTypes.DATEONLY, allowNull: false },
      repaymentFrequency: { type: DataTypes.ENUM('weekly', 'monthly'), allowNull: false },
      interestMethod:     { type: DataTypes.ENUM('flat', 'reducing'),  allowNull: false },

      // Keep as ENUM to match DB. (If you later add 'closed', alter the enum via a migration.)
      status:             { type: DataTypes.ENUM('pending', 'approved', 'rejected', 'disbursed'), defaultValue: 'pending' },

      approvedBy:         { type: DataTypes.INTEGER },
      approvalDate:       { type: DataTypes.DATE },
      disbursedBy:        { type: DataTypes.INTEGER },
      disbursementDate:   { type: DataTypes.DATE },
      disbursementMethod: { type: DataTypes.STRING },

      // createdAt / updatedAt come from timestamps: true
    },
    {
      tableName: 'loans',
      timestamps: true,
      underscored: false, // your migration created createdAt/updatedAt in camelCase
    }
  );
  return Loan;
};
