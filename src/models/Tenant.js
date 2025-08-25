'use strict';
module.exports = (sequelize, DataTypes) => {
  const Tenant = sequelize.define('Tenant', {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    name: { type: DataTypes.STRING, allowNull: false },
    status: { type: DataTypes.ENUM('active','suspended'), allowNull: false, defaultValue: 'active' },
  }, { tableName: 'tenants', timestamps: true });

  Tenant.associate = (models) => {
    Tenant.hasMany(models.TenantUser, { foreignKey: 'tenantId' });
    Tenant.hasMany(models.Subscription, { foreignKey: 'tenantId' });
  };
  return Tenant;
};
