// models/branch.js
'use strict';

module.exports = (sequelize, DataTypes) => {
  const Branch = sequelize.define(
    'Branch',
    {
      id:   { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING, allowNull: false },

      // 🔧 Compatibility shim: some queries select Branch.code, but the DB column doesn't exist.
      // Expose it as a VIRTUAL so Sequelize won't try to read a physical column.
      code: {
        type: DataTypes.VIRTUAL,
        get() {
          // If you want to synthesize a value, do it here.
          // e.g. return String(this.getDataValue('id')).padStart(3, '0');
          return null;
        },
      },
    },
    {
      tableName: 'Branches',  // matches your live table name (capitalized)
      paranoid: false,        // don't add deletedAt filters
      timestamps: false,      // flip to true only if your table really has createdAt/updatedAt
    }
  );

  Branch.associate = (models) => {
    if (models.User) {
      Branch.hasMany(models.User, { foreignKey: 'branchId', as: 'Users' });
    }
    if (models.Borrower) {
      Branch.hasMany(models.Borrower, { foreignKey: 'branchId', as: 'Borrowers' });
    }
  };

  return Branch;
};
