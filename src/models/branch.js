'use strict';

module.exports = (sequelize, DataTypes) => {
  const Branch = sequelize.define(
    'Branch',
    {
      id:   { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING, allowNull: false },
      // Keep extra attributes only if they exist in your DB. Safer to omit.
      // code: DataTypes.STRING,
      // phone: DataTypes.STRING,
      // address: DataTypes.TEXT,
    },
    {
      tableName: 'Branches',   // <-- matches your live DB
      timestamps: true,        // createdAt / updatedAt
      paranoid: true,          // if deletedAt exists, it's used; otherwise ignored at runtime
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
