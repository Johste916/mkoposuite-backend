'use strict';
module.exports = (sequelize, DataTypes) => {
  const TenantUser = sequelize.define('TenantUser', {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    tenantId: { type: DataTypes.UUID, allowNull: false },
    userId: { type: DataTypes.UUID, allowNull: false },
    role: { type: DataTypes.STRING, allowNull: false, defaultValue: 'staff' },
  }, { tableName: 'tenant_users', timestamps: true });

  TenantUser.associate = (models) => {
    TenantUser.belongsTo(models.Tenant, { foreignKey: 'tenantId' });
    if (models.User) TenantUser.belongsTo(models.User, { foreignKey: 'userId' });
  };
  return TenantUser;
};
