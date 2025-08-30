'use strict';

module.exports = (sequelize, DataTypes) => {
  const Branch = sequelize.define('Branch', {
    id:        { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    tenantId:  { type: DataTypes.BIGINT, field: 'tenant_id' },  // 👈 maps to tenant_id
    name:      { type: DataTypes.TEXT, allowNull: false },
    code:      { type: DataTypes.TEXT, allowNull: false, unique: true },
    email:     { type: DataTypes.TEXT },
    phone:     { type: DataTypes.TEXT },
    address:   { type: DataTypes.TEXT },
    status:    { type: DataTypes.TEXT, defaultValue: 'active' },
    createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW, field: 'created_at' },
    updatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW, field: 'updated_at' },
    deletedAt: { type: DataTypes.DATE, field: 'deleted_at' },
  }, {
    tableName: 'branches',
    timestamps: true,
    paranoid: true, // uses deleted_at if present
    underscored: true, // tells Sequelize to prefer snake_case in DB
  });

  return Branch;
};
