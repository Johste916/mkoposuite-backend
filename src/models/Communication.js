// models/Communication.js
module.exports = (sequelize, DataTypes) => {
  const Communication = sequelize.define(
    'Communication',
    {
      title: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      text: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      // Use ENUM if your DB supports it (Postgres). If using MySQL with older versions,
      // you can switch to STRING and validate allowed values in your service.
      type: {
        type: DataTypes.ENUM('notice', 'policy', 'alert', 'guideline'),
        allowNull: false,
        defaultValue: 'notice',
      },
      priority: {
        type: DataTypes.ENUM('low', 'normal', 'high', 'critical'),
        allowNull: false,
        defaultValue: 'normal',
      },

      // Targeting (null = all)
      audienceRole: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      audienceBranchId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },

      // Visibility window
      startAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      endAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },

      // Placement flags
      showOnDashboard: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      showInTicker: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },

      // Status
      isActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },

      // Audit
      createdBy: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      updatedBy: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
    },
    {
      tableName: 'communications',
      underscored: true,
      indexes: [
        { fields: ['type'] },
        { fields: ['priority'] },
        { fields: ['audience_branch_id'] },
        { fields: ['is_active'] },
        { fields: ['show_on_dashboard'] },
        { fields: ['show_in_ticker'] },
        { fields: ['start_at'] },
        { fields: ['end_at'] },
      ],
    }
  );

  Communication.associate = (models) => {
    Communication.hasMany(models.CommunicationAttachment, {
      as: 'attachments',
      foreignKey: 'communicationId',
      onDelete: 'CASCADE',
      hooks: true,
    });
  };

  return Communication;
};
