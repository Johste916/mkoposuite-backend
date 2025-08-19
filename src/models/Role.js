module.exports = (sequelize, DataTypes) => {
  const Role = sequelize.define(
    'Role',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      name: {
        type: DataTypes.STRING(80),
        allowNull: false,
        unique: true,
      },
      description: {
        type: DataTypes.STRING(255),
        allowNull: false,
        defaultValue: '',
      },
      // ✅ used by seeder; prevents “Unknown attributes (isSystem)” warning
      isSystem: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
    },
    {
      tableName: 'Roles',
      timestamps: true,
      indexes: [{ unique: true, fields: ['name'] }],
    }
  );

  return Role;
};
