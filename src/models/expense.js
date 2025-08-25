'use strict';

module.exports = (sequelize, DataTypes) => {
  const Expense = sequelize.define('Expense', {
    id:          { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    // multi-tenant
    tenantId:    { type: DataTypes.UUID, allowNull: false },
    // optional branch scoping (UUID to match your Supabase convention)
    branchId:    { type: DataTypes.UUID, allowNull: true },

    // core fields
    date:        { type: DataTypes.DATEONLY, allowNull: false },
    type:        { type: DataTypes.STRING,   allowNull: true },     // e.g. Utilities, Salaries, Rent...
    vendor:      { type: DataTypes.STRING,   allowNull: true },
    reference:   { type: DataTypes.STRING,   allowNull: true },     // invoice/ref no.
    amount:      { type: DataTypes.DECIMAL(18,2), allowNull: false },
    note:        { type: DataTypes.TEXT,     allowNull: true },

    // optional lifecycle
    status: {
      type: DataTypes.ENUM('POSTED', 'VOID'),
      allowNull: false,
      defaultValue: 'POSTED'
    },

    // audit (soft)
    createdBy:   { type: DataTypes.UUID, allowNull: true },
    updatedBy:   { type: DataTypes.UUID, allowNull: true },
  }, {
    tableName: 'expenses',
    schema: 'public',
    timestamps: true,
    indexes: [
      { fields: ['tenantId'] },
      { fields: ['tenantId', 'date'] },
      { fields: ['tenantId', 'branchId'] },
    ],
  });

  Expense.associate = (models) => {
    if (models.Branch) {
      Expense.belongsTo(models.Branch, { foreignKey: 'branchId', as: 'branch' });
    }
    if (models.User) {
      Expense.belongsTo(models.User,   { foreignKey: 'createdBy', as: 'creator' });
      Expense.belongsTo(models.User,   { foreignKey: 'updatedBy', as: 'updater' });
    }
  };

  return Expense;
};
