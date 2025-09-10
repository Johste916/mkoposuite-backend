'use strict';
module.exports = (sequelize, DataTypes) => {
  const Tenant = sequelize.define('Tenant', {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    name: { type: DataTypes.STRING, allowNull: false },
    status: { type: DataTypes.ENUM('trial','trialing','active','past_due','suspended','cancelled'), allowNull: false, defaultValue: 'trial' },
    plan_code: { type: DataTypes.STRING, allowNull: false, defaultValue: 'basic' },
    trial_ends_at: { type: DataTypes.DATEONLY, allowNull: true },
    billing_email: { type: DataTypes.STRING, allowNull: true },
    auto_disable_overdue: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    grace_days: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 7 },
    seats: { type: DataTypes.INTEGER, allowNull: true },
  }, { tableName: 'tenants', underscored: true, timestamps: true });

  Tenant.associate = (models) => {
    Tenant.hasMany(models.TenantUser, { foreignKey: 'tenant_id' });
    if (models.Invoice) Tenant.hasMany(models.Invoice, { foreignKey: 'tenant_id' });
  };
  return Tenant;
};
