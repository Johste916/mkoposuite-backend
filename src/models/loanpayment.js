// src/models/loanPayment.js
'use strict';

module.exports = (sequelize, DataTypes) => {
  const LoanPayment = sequelize.define(
    'LoanPayment',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

      // DB column: loanId (camelCase in DB, since you're using the CamelCase table)
      loanId: { type: DataTypes.INTEGER, allowNull: false, field: 'loanId' },

      // Use the DB column `amount` but expose it as amountPaid in JS
      amountPaid: {
        type: DataTypes.DECIMAL(14, 2),
        allowNull: false,
        field: 'amount',
        get() {
          const raw = this.getDataValue('amountPaid');
          // normalize to string with 2 dp; keep as string to avoid float drift
          return raw == null ? null : raw.toString();
        },
      },

      // DB column: paymentDate (DATE or TIMESTAMP). If you use DATEONLY, change to DataTypes.DATEONLY
      paymentDate: { type: DataTypes.DATE, allowNull: true, field: 'paymentDate' },

      status:   { type: DataTypes.STRING,  allowNull: false, defaultValue: 'POSTED', field: 'status' },
      applied:  { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true,    field: 'applied' },

      borrowerId: { type: DataTypes.INTEGER, allowNull: true, field: 'borrowerId' },
      productId:  { type: DataTypes.INTEGER, allowNull: true, field: 'productId' },

      // Keep UUID only if your users.id is UUID; otherwise change to INTEGER to match FK
      officerId:  { type: DataTypes.UUID,    allowNull: true, field: 'officerId' },

      // snake_case columns kept as-is in DB
      branchId:   { type: DataTypes.INTEGER, allowNull: true, field: 'branch_id' },
      tenantId:   { type: DataTypes.INTEGER, allowNull: true, field: 'tenant_id' },
      userId:     { type: DataTypes.INTEGER, allowNull: true, field: 'user_id' },
    },
    {
      schema: 'public',
      tableName: 'LoanPayment',       // real TABLE (not a view)
      freezeTableName: true,
      underscored: true,              // created_at / updated_at on the table
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',

      defaultScope: {
        order: [['created_at', 'DESC']],
      },

      indexes: [
        { fields: ['loanId'] },
        { fields: ['status'] },
        { fields: ['paymentDate'] },
        { fields: ['branch_id'] },
        { fields: ['tenant_id'] },
      ],
    }
  );

  LoanPayment.associate = (models) => {
    // loan
    if (models.Loan && !LoanPayment.associations?.Loan) {
      LoanPayment.belongsTo(models.Loan, {
        as: 'Loan',
        foreignKey: 'loanId',
        targetKey: 'id',
      });
    }

    // borrower
    if (models.Borrower && !LoanPayment.associations?.Borrower) {
      LoanPayment.belongsTo(models.Borrower, {
        as: 'Borrower',
        foreignKey: 'borrowerId',
        targetKey: 'id',
        constraints: false,
      });
    }

    // officer (User)
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
