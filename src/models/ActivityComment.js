// src/models/ActivityComment.js
module.exports = (sequelize, DataTypes) => {
  const ActivityComment = sequelize.define('ActivityComment', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    activityId: { type: DataTypes.INTEGER, allowNull: false },
    userId: { type: DataTypes.INTEGER, allowNull: false },
    comment: { type: DataTypes.TEXT, allowNull: false },
  }, {
    tableName: 'ActivityComments',
    timestamps: true,
  });

  ActivityComment.associate = (models) => {
    ActivityComment.belongsTo(models.ActivityLog, { foreignKey: 'activityId' });
    ActivityComment.belongsTo(models.User, { foreignKey: 'userId' });
  };

  return ActivityComment;
};
