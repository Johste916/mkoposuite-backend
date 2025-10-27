// src/models/loanPayment.js
'use strict';

module.exports = (sequelize, DataTypes) => {
  const LoanPayment = sequelize.define(
    'LoanPayment',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

      loanId: { type: DataTypes.INTEGER, allowNull: false, field: 'loanId' }, // DB camel

      // DB column is 'amount'; we present it as 'amountPaid' to the app
      amountPaid: {
        type: DataTypes.DECIMAL(14, 2),
        allowNull: false,
        field: 'amount',
        get() {
          const raw = this.getDataValue('amountPaid');
          return raw == null ? null : raw.toString();
        },
      },

      paymentDate: { type: DataTypes.DATEONLY, allowNull: true, field: 'paymentDate' }, // DB camel date
      status:      { type: DataTypes.STRING,  allowNull: false, defaultValue: 'POSTED', field: 'status' },
      applied:     { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true,     field: 'applied' },

      borrowerId:  { type: DataTypes.INTEGER, allowNull: true, field: 'borrowerId' },
      productId:   { type: DataTypes.INTEGER, allowNull: true, field: 'productId' },

      // keep integer per your note; association has constraints:false due to UUID users
      officerId:   { type: DataTypes.INTEGER, allowNull: true, field: 'officerId' },

      branchId:    { type: DataTypes.INTEGER, allowNull: true, field: 'branch_id' }, // snake
      tenantId:    { type: DataTypes.INTEGER, allowNull: true, field: 'tenant_id' }, // snake
      userId:      { type: DataTypes.INTEGER, allowNull: true, field: 'user_id' },   // snake
    },
    {
      schema: 'public',
      tableName: 'LoanPayment',  // keep your existing name
      freezeTableName: true,

      // This table uses snake timestamps in DB
      underscored: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',

      indexes: [
        { fields: ['loanId'] },
        { fields: ['status'] },
        { fields: ['paymentDate'] },
        { fields: ['branch_id'] },
        { fields: ['tenant_id'] },
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
        constraints: false, // integer → UUID mismatch guarded
      });
    }
  };

  return LoanPayment;
};
