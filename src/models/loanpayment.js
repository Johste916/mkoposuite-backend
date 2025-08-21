// models/LoanPayment.js
module.exports = (sequelize, DataTypes) => {
  const LoanPayment = sequelize.define("LoanPayment", {
    loanId: { type: DataTypes.BIGINT, allowNull: false },
    date: { type: DataTypes.DATEONLY, allowNull: false },
    amount: { type: DataTypes.DECIMAL(18,2), allowNull: false },
    currency: { type: DataTypes.STRING(8), defaultValue: "TZS" },
    method: { type: DataTypes.STRING(32), defaultValue: "cash" },
    reference: { type: DataTypes.STRING(128) },
    notes: { type: DataTypes.TEXT },
    allocation: { type: DataTypes.JSONB },
    postedBy: { type: DataTypes.BIGINT },
  }, {
    tableName: "loan_payments",
    underscored: false,
  });

  LoanPayment.associate = (models) => {
    LoanPayment.belongsTo(models.Loan, { foreignKey: "loanId" });
    LoanPayment.belongsTo(models.User, { foreignKey: "postedBy", as: "poster" });
  };

  return LoanPayment;
};
