// server/models/tenant.js
'use strict';

module.exports = (sequelize, DataTypes) => {
  const Tenant = sequelize.define('Tenant', {
    id:                 { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    name:               { type: DataTypes.STRING, allowNull: false },
    // keep your existing enum; DB is fine if it’s TEXT
    status:             { type: DataTypes.ENUM('trial','trialing','active','past_due','suspended','cancelled'), allowNull: false, defaultValue: 'trial' },
    plan_code:          { type: DataTypes.STRING, allowNull: false, defaultValue: 'basic' },
    trial_ends_at:      { type: DataTypes.DATEONLY, allowNull: true },
    billing_email:      { type: DataTypes.STRING, allowNull: true },
    auto_disable_overdue:{ type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    grace_days:         { type: DataTypes.INTEGER, allowNull: false, defaultValue: 7 },
    seats:              { type: DataTypes.INTEGER, allowNull: true },

    /* 🔹 add columns that exist in DB so inserts don’t fail */
    country:            { type: DataTypes.STRING(2),  allowNull: false, defaultValue: process.env.DEFAULT_COUNTRY  || 'TZ'  },
    currency:           { type: DataTypes.STRING(3),  allowNull: false, defaultValue: process.env.DEFAULT_CURRENCY || 'TZS' },
    slug:               { type: DataTypes.STRING(64), allowNull: true }, // DB may enforce unique; model doesn’t change schema
    staff_count:        { type: DataTypes.INTEGER, allowNull: true, defaultValue: 0 },

  }, { tableName: 'tenants', underscored: true, timestamps: true });

  Tenant.associate = (models) => {
    Tenant.hasMany(models.TenantUser, { foreignKey: 'tenant_id' });
    if (models.Invoice) Tenant.hasMany(models.Invoice, { foreignKey: 'tenant_id' });
  };

  return Tenant;
};
