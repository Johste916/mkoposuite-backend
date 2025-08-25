'use strict';
module.exports = (sequelize, DataTypes) => {
  const SubscriptionItem = sequelize.define('SubscriptionItem', {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    subscriptionId: { type: DataTypes.UUID, allowNull: false },
    moduleKey: { type: DataTypes.STRING, allowNull: false }, // e.g. "expenses", "savings"
    seats: { type: DataTypes.INTEGER, defaultValue: 1 },
    active: { type: DataTypes.BOOLEAN, default: true },
  }, { tableName: 'subscription_items', timestamps: true });

  SubscriptionItem.associate = (models) => {
    SubscriptionItem.belongsTo(models.Subscription, { foreignKey: 'subscriptionId' });
  };
  return SubscriptionItem;
};
