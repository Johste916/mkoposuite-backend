'use strict';

module.exports = (sequelize, DataTypes) => {
  const Expense = sequelize.define('Expense', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },

    // tenant + org context (snake_case columns)
    tenantId:  { type: DataTypes.UUID, allowNull: false, field: 'tenant_id' },
    branchId:  { type: DataTypes.UUID, allowNull: true,  field: 'branch_id' },

    // core fields
    date:      { type: DataTypes.DATEONLY, allowNull: false },
    type:      { type: DataTypes.STRING,   allowNull: false }, // OPERATING / ADMIN / MARKETING / OTHER
    vendor:    { type: DataTypes.STRING,   allowNull: true  },
    reference: { type: DataTypes.STRING,   allowNull: true  },
    amount:    { type: DataTypes.DECIMAL(18,2), allowNull: false, defaultValue: 0 },
    note:      { type: DataTypes.TEXT,     allowNull: true  },

    // optional status (your table seems to have it; keep it nullable or default)
    status:    { type: DataTypes.STRING,   allowNull: true,  defaultValue: 'POSTED' },

    // audit
    createdBy: { type: DataTypes.UUID, allowNull: true, field: 'created_by' },
    updatedBy: { type: DataTypes.UUID, allowNull: true, field: 'updated_by' },

    // timestamps mapped to snake_case
    createdAt: { type: DataTypes.DATE, allowNull: false, field: 'created_at' },
    updatedAt: { type: DataTypes.DATE, allowNull: false, field: 'updated_at' },
  }, {
    tableName: 'expenses',
    schema: 'public',
    timestamps: true,
    underscored: true, // tell Sequelize your table uses snake_case
  });

  Expense.associate = (models) => {
    if (models.User) {
      Expense.belongsTo(models.User,   { foreignKey: 'createdBy', as: 'creator' });
      Expense.belongsTo(models.User,   { foreignKey: 'updatedBy', as: 'updater' });
    }
    if (models.Branch) {
      Expense.belongsTo(models.Branch, { foreignKey: 'branchId',  as: 'branch'  });
    }
  };

  return Expense;
};
