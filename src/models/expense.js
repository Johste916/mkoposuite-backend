'use strict';

module.exports = (sequelize, DataTypes) => {
  const Expense = sequelize.define('Expense', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },

    // multi-tenant & org context (no FKs to avoid cross-env breakage)
    tenantId:   { type: DataTypes.UUID, allowNull: true },
    branchId:   { type: DataTypes.UUID, allowNull: true },

    // core fields
    date:       { type: DataTypes.DATEONLY, allowNull: false },
    type:       { type: DataTypes.STRING,   allowNull: false }, // e.g. OPERATING / ADMIN / MARKETING / OTHER
    vendor:     { type: DataTypes.STRING,   allowNull: true  },
    reference:  { type: DataTypes.STRING,   allowNull: true  },
    amount:     { type: DataTypes.DECIMAL(18,2), allowNull: false, defaultValue: 0 },
    note:       { type: DataTypes.TEXT,     allowNull: true  },

    // audit (optional)
    createdBy:  { type: DataTypes.UUID, allowNull: true },
    updatedBy:  { type: DataTypes.UUID, allowNull: true },
  }, {
    tableName: 'expenses',
    schema: 'public',
    timestamps: true, // uses createdAt / updatedAt (camelCase)
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
