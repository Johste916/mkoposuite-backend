// models/setting.js

module.exports = (sequelize, DataTypes) => {
  const Setting = sequelize.define('Setting', {
    key: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      validate: {
        isIn: [[
          'loanSettings',
          'penaltySettings',
          'systemSettings',
          'integrationSettings',
          'dashboardSettings',
          'bulkSmsSettings',
          'paymentSettings',
          'savingAccountSettings',
          'payrollSettings',
          'commentSettings',
          'holidaySettings',
          'loanSectorSettings',
          'incomeSourceSettings',
          'userManagementSettings',
          'borrowerSettings'
        ]]
      }
    },
    value: {
      type: DataTypes.JSONB, // for storing mixed data (object, array, etc.)
      allowNull: false,
      defaultValue: {}
    },
    description: {
      type: DataTypes.STRING,
      defaultValue: ''
    },
    updatedBy: {
      type: DataTypes.UUID,
      allowNull: true
    }
  }, {
    timestamps: true,
    tableName: 'settings'
  });

  return Setting;
};
