// src/models/ActivityAssignment.js
module.exports = (sequelize, DataTypes) => {
  const ActivityAssignment = sequelize.define('ActivityAssignment', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    activityId: { type: DataTypes.INTEGER, allowNull: false },
    assigneeId: { type: DataTypes.INTEGER, allowNull: false },
    assignerId: { type: DataTypes.INTEGER, allowNull: false },
    dueDate: { type: DataTypes.DATE, allowNull: true },
    note: { type: DataTypes.TEXT, allowNull: true },
    status: { type: DataTypes.ENUM('open', 'done'), allowNull: false, defaultValue: 'open' },
  }, {
    tableName: 'ActivityAssignments',
    timestamps: true,
  });

  ActivityAssignment.associate = (models) => {
    ActivityAssignment.belongsTo(models.ActivityLog, { foreignKey: 'activityId' });
    ActivityAssignment.belongsTo(models.User, { as: 'assignee', foreignKey: 'assigneeId' });
    ActivityAssignment.belongsTo(models.User, { as: 'assigner', foreignKey: 'assignerId' });
  };

  return ActivityAssignment;
};
