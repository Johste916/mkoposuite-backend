// backend/src/models/ReportSubscription.js
module.exports = (sequelize, DataTypes) => {
  const ReportSubscription = sequelize.define('ReportSubscription', {
    name:            { type: DataTypes.STRING, allowNull: false },
    reportKey:       { type: DataTypes.STRING, allowNull: false }, // e.g. "loans.dailySummary"
    frequency:       { type: DataTypes.ENUM('daily','weekly','monthly','quarterly','semiannual','annual','custom'), allowNull: false, defaultValue: 'daily' },
    timeOfDay:       { type: DataTypes.STRING, allowNull: false, defaultValue: '09:00' }, // HH:mm (server TZ)
    dayOfWeek:       { type: DataTypes.INTEGER, allowNull: true },  // 0=Sun..6=Sat (weekly)
    dayOfMonth:      { type: DataTypes.INTEGER, allowNull: true },  // 1..31 (monthly/quarterly/semiannual/annual)
    monthOfYear:     { type: DataTypes.INTEGER, allowNull: true },  // 1..12 (annual/semiannual/quarterly)
    cron:            { type: DataTypes.STRING, allowNull: true },    // when frequency === 'custom'
    format:          { type: DataTypes.ENUM('csv','pdf','xlsx'), allowNull: false, defaultValue: 'csv' },
    filters:         { type: DataTypes.JSONB, allowNull: true, defaultValue: {} },

    // recipients
    recipientsType:  { type: DataTypes.ENUM('role','user','emails'), allowNull: false, defaultValue: 'role' },
    roleId:          { type: DataTypes.INTEGER, allowNull: true },
    userId:          { type: DataTypes.INTEGER, allowNull: true },
    emails:          { type: DataTypes.ARRAY(DataTypes.STRING), allowNull: true, defaultValue: [] },

    active:          { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    lastRunAt:       { type: DataTypes.DATE, allowNull: true },
    nextRunAt:       { type: DataTypes.DATE, allowNull: true },

    createdBy:       { type: DataTypes.INTEGER, allowNull: true },
  }, {
    tableName: 'report_subscriptions',
    underscored: true,
  });

  return ReportSubscription;
};
