// models/CommunicationAttachment.js
module.exports = (sequelize, DataTypes) => {
  const CommunicationAttachment = sequelize.define(
    'CommunicationAttachment',
    {
      communicationId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      fileName: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      mimeType: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      size: {
        type: DataTypes.INTEGER, // bytes
        allowNull: false,
        validate: { min: 0 },
      },
      fileUrl: {
        type: DataTypes.STRING,
        allowNull: false,
      },
    },
    {
      tableName: 'communication_attachments',
      underscored: true,
      indexes: [{ fields: ['communication_id'] }],
    }
  );

  CommunicationAttachment.associate = (models) => {
    CommunicationAttachment.belongsTo(models.Communication, {
      foreignKey: 'communicationId',
      as: 'communication',
    });
  };

  return CommunicationAttachment;
};
