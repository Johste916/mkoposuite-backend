// src/models/loanpayment.js
module.exports = (sequelize, DataTypes) => {
  const isPg = sequelize.getDialect && sequelize.getDialect() === "postgres";
  const JSON_TYPE = isPg ? DataTypes.JSONB : DataTypes.JSON;

  const LoanPayment = sequelize.define(
    "LoanPayment",
    {
      loanId: { type: DataTypes.INTEGER, allowNull: false, field: "loanId" },

      // NOTE: logs show Users.id is UUID; this matches. (We also ship a migration below to enforce it.)
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
      // DB may be an ENUM (PG); using STRING with validation is safe across dialects.
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

      allocation: { type: JSON_TYPE, allowNull: true, field: "allocation" }, // allocation lines
      voidReason: { type: DataTypes.TEXT, allowNull: true, field: "voidReason" },
    },
    {
      tableName: "loan_payments",
      timestamps: true,
      defaultScope: {
        order: [
          ["paymentDate", "DESC"],
          ["createdAt", "DESC"],
        ],
      },
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
