'use strict';
module.exports = (sequelize, DataTypes) => {
  const Subscription = sequelize.define('Subscription', {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    tenantId: { type: DataTypes.UUID, allowNull: false },
    planName: { type: DataTypes.STRING, allowNull: false }, // e.g. "standard"
    startsAt: { type: DataTypes.DATE, allowNull: false },
    endsAt: { type: DataTypes.DATE, allowNull: false },
    status: { type: DataTypes.ENUM('active','expired','cancelled'), defaultValue: 'active' },
  }, { tableName: 'subscriptions', timestamps: true });

  Subscription.associate = (models) => {
    Subscription.belongsTo(models.Tenant, { foreignKey: 'tenantId' });
    Subscription.hasMany(models.SubscriptionItem, { foreignKey: 'subscriptionId', as: 'items' });
  };
  return Subscription;
};
