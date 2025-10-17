'use strict';

module.exports = (sequelize, DataTypes) => {
  const UserRole = sequelize.define(
    'UserRole',
    {
      // Composite key (no auto id)
      userId: { type: DataTypes.UUID, allowNull: false, field: 'user_id', primaryKey: true },
      roleId: { type: DataTypes.UUID, allowNull: false, field: 'role_id', primaryKey: true },
    },
    {
      tableName: 'user_roles',
      underscored: true,        // created_at / updated_at
      timestamps: true,
      indexes: [
        { fields: ['user_id'] },
        { fields: ['role_id'] },
        { unique: true, fields: ['user_id', 'role_id'], name: 'user_roles_user_id_role_id_key' },
      ],
    }
  );

  // Associations (handy for includes / integrity checks)
  UserRole.associate = (models) => {
    if (models.User) UserRole.belongsTo(models.User, { foreignKey: 'userId', targetKey: 'id' });
    if (models.Role) UserRole.belongsTo(models.Role, { foreignKey: 'roleId', targetKey: 'id' });
  };

  return UserRole;
};
