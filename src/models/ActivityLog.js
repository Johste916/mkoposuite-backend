// src/models/ActivityLog.js
module.exports = (sequelize, DataTypes) => {
  const ActivityLog = sequelize.define('ActivityLog', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    type: { type: DataTypes.STRING(50), allowNull: false },           // e.g., 'repayment', 'loan', 'borrower'
    entityType: { type: DataTypes.STRING(50), allowNull: true },      // e.g., 'Loan', 'Borrower'
    entityId: { type: DataTypes.INTEGER, allowNull: true },
    message: { type: DataTypes.TEXT, allowNull: false },              // human-friendly description
    userId: { type: DataTypes.INTEGER, allowNull: true },             // actor who did the action
  }, {
    tableName: 'ActivityLogs',
    timestamps: true,
  });

  ActivityLog.associate = (models) => {
    ActivityLog.belongsTo(models.User, { foreignKey: 'userId' });
    ActivityLog.hasMany(models.ActivityComment, { foreignKey: 'activityId', as: 'comments', onDelete: 'CASCADE' });
    ActivityLog.hasMany(models.ActivityAssignment, { foreignKey: 'activityId', as: 'assignments', onDelete: 'CASCADE' });
  };

  return ActivityLog;
};
