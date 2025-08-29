// server/src/models/branch.js
'use strict';

module.exports = (sequelize, DataTypes) => {
  const Branch = sequelize.define('Branch', {
    id:        { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    tenantId:  { type: DataTypes.UUID, allowNull: true, index: true },
    name:      { type: DataTypes.STRING(150), allowNull: false },
    code:      { type: DataTypes.STRING(50), allowNull: false },
    phone:     { type: DataTypes.STRING(40), allowNull: true },
    email:     { type: DataTypes.STRING(120), allowNull: true, validate: { isEmail: true } },
    address:   { type: DataTypes.STRING(250), allowNull: true },
    city:      { type: DataTypes.STRING(100), allowNull: true },
    country:   { type: DataTypes.STRING(100), allowNull: true },
    isActive:  { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    // If/when you add a migration, you can re-enable paranoid and add this:
    // deletedAt: { type: DataTypes.DATE, allowNull: true },
  }, {
    tableName: 'branches',
    paranoid: false,          // ⬅️ disable until you add the column
    timestamps: true,
    indexes: [
      { fields: ['tenantId'] },
      { unique: false, fields: ['code', 'tenantId'] },
      { fields: ['name'] },
    ],
  });

  return Branch;
};
