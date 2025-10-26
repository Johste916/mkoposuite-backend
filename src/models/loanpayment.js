// src/models/loanPayment.js
'use strict';

module.exports = (sequelize, DataTypes) => {
  const LoanPayment = sequelize.define(
    'LoanPayment',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

      // DB column: loanId
      loanId: { type: DataTypes.INTEGER, allowNull: false, field: 'loanId' },

      // Maps DB 'amount' -> JS 'amountPaid'
      amountPaid: {
        type: DataTypes.DECIMAL(14, 2),
        allowNull: false,
        field: 'amount',
        get() {
          const raw = this.getDataValue('amountPaid');
          return raw == null ? null : raw.toString();
        },
      },

      // DB shows DATE, so use DATEONLY
      paymentDate: { type: DataTypes.DATEONLY, allowNull: true, field: 'paymentDate' },
      status:      { type: DataTypes.STRING,  allowNull: false, defaultValue: 'POSTED', field: 'status' },
      applied:     { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true,     field: 'applied' },

      borrowerId:  { type: DataTypes.INTEGER, allowNull: true, field: 'borrowerId' },
      productId:   { type: DataTypes.INTEGER, allowNull: true, field: 'productId' },

      // DB shows integer
      officerId:   { type: DataTypes.INTEGER, allowNull: true, field: 'officerId' },

      branchId:    { type: DataTypes.INTEGER, allowNull: true, field: 'branch_id' },
      tenantId:    { type: DataTypes.INTEGER, allowNull: true, field: 'tenant_id' },
      userId:      { type: DataTypes.INTEGER, allowNull: true, field: 'user_id' },
    },
    {
      schema: 'public',
      tableName: 'LoanPayment',
      freezeTableName: true,

      // Timestamps map to snake_case columns on the real table
      underscored: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',

      // NOTE: no defaultScope with order here to avoid double ORDER BYs
      indexes: [
        { fields: ['loanId'] },
        { fields: ['status'] },
        { fields: ['paymentDate'] },
        { fields: ['branch_id'] },
        { fields: ['tenant_id'] },
        // DB already has an index on created_at, fine to list here too
        { fields: ['created_at'] },
      ],
    }
  );

  LoanPayment.associate = (models) => {
    if (models.Loan && !LoanPayment.associations?.Loan) {
      LoanPayment.belongsTo(models.Loan, {
        as: 'Loan',
        foreignKey: 'loanId',
        targetKey: 'id',
      });
    }
    if (models.Borrower && !LoanPayment.associations?.Borrower) {
      LoanPayment.belongsTo(models.Borrower, {
        as: 'Borrower',
        foreignKey: 'borrowerId',
        targetKey: 'id',
        constraints: false,
      });
    }
    if (models.User && !LoanPayment.associations?.Officer) {
      LoanPayment.belongsTo(models.User, {
        as: 'Officer',
        foreignKey: 'officerId',
        targetKey: 'id',
        constraints: false,
      });
    }
  };

  return LoanPayment;
};
