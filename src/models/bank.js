'use strict';

module.exports = (sequelize, DataTypes) => {
  const Bank = sequelize.define('Bank', {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4, // generated client-side; no DB extension required
    },
    tenantId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    name: {
      type: DataTypes.STRING(120),
      allowNull: false,
    },
    code: {
      type: DataTypes.STRING(32),
      allowNull: true,
    },
    branch: {
      type: DataTypes.STRING(120),
      allowNull: true,
    },
    accountName: {
      type: DataTypes.STRING(180),
      allowNull: true,
    },
    accountNumber: {
      type: DataTypes.STRING(64),
      allowNull: false,
    },
    swift: {
      type: DataTypes.STRING(64),
      allowNull: true,
    },
    phone: {
      type: DataTypes.STRING(40),
      allowNull: true,
    },
    address: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  }, {
    tableName: 'banks',
    schema: 'public',
    underscored: false,
    indexes: [
      { fields: ['tenantId'] },
      { fields: ['code'] },
      { unique: true, fields: ['tenantId', 'accountNumber'] },
    ],
  });

  return Bank;
};
