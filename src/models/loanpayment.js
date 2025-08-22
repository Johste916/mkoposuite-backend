// src/models/loanpayment.js
module.exports = (sequelize, DataTypes) => {
  const LoanPayment = sequelize.define(
    "LoanPayment",
    {
      loanId: { type: DataTypes.INTEGER, allowNull: false, field: "loanId" },

      // NOTE: keep this type in sync with your Users table (UUID or INTEGER)
      userId: { type: DataTypes.UUID, allowNull: true, field: "userId" },

      // amounts/dates
      amountPaid: {
        type: DataTypes.DECIMAL(14, 2),
        allowNull: false,
        defaultValue: 0,
        field: "amountPaid",
      },
      paymentDate: { type: DataTypes.DATEONLY, allowNull: false, field: "paymentDate" },

      // meta
      method: { type: DataTypes.STRING, allowNull: true, field: "method" }, // 'cash','mobile','bank', etc
      notes: { type: DataTypes.TEXT, allowNull: true, field: "notes" },

      // Workflow + external/gateway
      // Use STRING(16) + validate to align with migration that added VARCHAR column
      status: {
        type: DataTypes.STRING(16),
        allowNull: false,
        defaultValue: "approved",
        validate: { isIn: [["pending", "approved", "rejected", "voided"]] },
        field: "status",
      },
      applied: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: "applied" },
      reference: { type: DataTypes.STRING, allowNull: true, field: "reference" }, // payer ref / internal ref
      receiptNo: { type: DataTypes.STRING, allowNull: true, field: "receiptNo" },
      currency: { type: DataTypes.STRING(8), allowNull: true, field: "currency" },

      gateway: { type: DataTypes.STRING, allowNull: true, field: "gateway" }, // 'mpesa','tigo','bank-xyz', etc
      gatewayRef: { type: DataTypes.STRING, allowNull: true, field: "gatewayRef" }, // provider txn id

      allocation: { type: DataTypes.JSONB, allowNull: true, field: "allocation" }, // allocation lines
      voidReason: { type: DataTypes.TEXT, allowNull: true, field: "voidReason" },
    },
    {
      tableName: "loan_payments",
      timestamps: true,
      indexes: [
        { fields: ["loanId"] },
        { fields: ["userId"] },
        { fields: ["paymentDate"] },
        { fields: ["status"] },
        { fields: ["reference"] },
        { fields: ["gatewayRef"] },
        { fields: ["createdAt"] },
      ],
    }
  );

  LoanPayment.associate = (models) => {
    if (models.Loan) {
      LoanPayment.belongsTo(models.Loan, { foreignKey: "loanId" });
    }
    if (models.User) {
      LoanPayment.belongsTo(models.User, { foreignKey: "userId" });
    }
  };

  return LoanPayment;
};
