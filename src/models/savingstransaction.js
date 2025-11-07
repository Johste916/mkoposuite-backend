'use strict';

module.exports = (sequelize, DataTypes) => {
  const SavingsTransaction = sequelize.define(
    'SavingsTransaction',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

      borrowerId: { type: DataTypes.INTEGER, allowNull: false },

      type: {
        type: DataTypes.ENUM('deposit', 'withdrawal', 'charge', 'interest'),
        allowNull: false,
      },

      amount: { type: DataTypes.DECIMAL(18, 2), allowNull: false, defaultValue: 0 },
      date: { type: DataTypes.DATEONLY, allowNull: false },
      notes: { type: DataTypes.TEXT, allowNull: true },
      reference: { type: DataTypes.STRING, allowNull: true },

      // Approval workflow
      status: {
        type: DataTypes.ENUM('pending', 'approved', 'rejected'),
        allowNull: false,
        defaultValue: 'pending',
      },
      createdBy:       { type: DataTypes.STRING, allowNull: true }, // string to avoid int/uuid mismatch
      approvedBy:      { type: DataTypes.STRING, allowNull: true },
      approvedAt:      { type: DataTypes.DATE,  allowNull: true },
      approvalComment: { type: DataTypes.TEXT,  allowNull: true },

      reversed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    },
    {
      tableName: 'SavingsTransactions',      // keep as-is to match existing table
      freezeTableName: true,
      timestamps: true,                      // aligns with global camel createdAt/updatedAt
      underscored: false,
      indexes: [
        { fields: ['borrowerId'] },
        { fields: ['type'] },
        { fields: ['date'] },
        { fields: ['status'] },
      ],
    }
  );

  return SavingsTransaction;
};
