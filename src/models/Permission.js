'use strict';

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
      action: {
        type: DataTypes.STRING(120),
        allowNull: false,
        unique: true,
      },
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

  Permission.associate = (models) => {
    if (models.Role && models.RolePermission) {
      Permission.belongsToMany(models.Role, {
        through: models.RolePermission,
        foreignKey: 'permissionId',
        otherKey: 'roleId',
        as: 'Roles',
      });
    }
  };

  return Permission;
};
