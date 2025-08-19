module.exports = (sequelize, DataTypes) => {
  const JSON_TYPE =
    sequelize.getDialect && sequelize.getDialect() === 'postgres'
      ? DataTypes.JSONB
      : DataTypes.JSON;

  const Permission = sequelize.define(
    'Permission',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      // action like "staff.read", "staff.create", etc.
      action: {
        type: DataTypes.STRING(120),
        allowNull: false,
        unique: true,
      },
      // optional: list of role names that have this permission
      // (works with your existing allow(...) middleware style)
      roles: {
        type: JSON_TYPE,
        allowNull: false,
        defaultValue: [],
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
      tableName: 'Permissions',
      timestamps: true,
      indexes: [{ unique: true, fields: ['action'] }],
    }
  );

  return Permission;
};
