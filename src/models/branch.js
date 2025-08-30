'use strict';
module.exports = (sequelize, DataTypes) => {
  const Branch = sequelize.define('Branch', {
    id:        { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    tenantId:  { type: DataTypes.BIGINT, field: 'tenant_id' },
    name:      { type: DataTypes.TEXT, allowNull: false },
    code:      { type: DataTypes.TEXT, allowNull: false, unique: true },
    email:     { type: DataTypes.TEXT },
    phone:     { type: DataTypes.TEXT },
    address:   { type: DataTypes.TEXT },
    status:    { type: DataTypes.TEXT, defaultValue: 'active' },
    geoLat:    { type: DataTypes.DECIMAL(10,6), field: 'geo_lat' },
    geoLng:    { type: DataTypes.DECIMAL(10,6), field: 'geo_lng' },
    createdAt: { type: DataTypes.DATE, field: 'created_at', defaultValue: DataTypes.NOW },
    updatedAt: { type: DataTypes.DATE, field: 'updated_at', defaultValue: DataTypes.NOW },
    deletedAt: { type: DataTypes.DATE, field: 'deleted_at' },
  }, {
    tableName: 'branches',
    timestamps: true,
    paranoid: true,
    underscored: true,
  });
  return Branch;
};
