'use strict';
module.exports = (sequelize, DataTypes) => {
  const TenantUser = sequelize.define('TenantUser', {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    tenant_id: { type: DataTypes.UUID, allowNull: false },
    user_id: { type: DataTypes.UUID, allowNull: false },
    role: { type: DataTypes.STRING, allowNull: false, defaultValue: 'staff' },
  }, { tableName: 'tenant_users', underscored: true, timestamps: true });

  TenantUser.associate = (models) => {
    TenantUser.belongsTo(models.Tenant, { foreignKey: 'tenant_id' });
    if (models.User) TenantUser.belongsTo(models.User, { foreignKey: 'user_id' });
  };
  return TenantUser;
};
