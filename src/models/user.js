'use strict';

module.exports = (sequelize, DataTypes) => {
  const User = sequelize.define(
    'User',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      name: { type: DataTypes.STRING, allowNull: false },
      email: { type: DataTypes.STRING, allowNull: false, unique: true, validate: { isEmail: true } },
      password_hash: { type: DataTypes.STRING, allowNull: false },
      password: { type: DataTypes.VIRTUAL }, // write-time only
      role: { type: DataTypes.STRING, defaultValue: 'user' },
      branchId: { type: DataTypes.INTEGER, allowNull: true },
    },
    {
      tableName: 'Users',
      timestamps: true,
      defaultScope: { attributes: { exclude: ['password_hash'] } },
      scopes: { withSensitive: {} },
    }
  );

  User.prototype.toJSON = function () {
    const obj = { ...this.get() };
    delete obj.password_hash;
    return obj;
  };

  User.associate = (models) => {
    if (models.Role) {
      User.belongsToMany(models.Role, {
        through: 'UserRoles',
        foreignKey: 'userId',
        otherKey: 'roleId',
        as: 'Roles',
      });
    }

    if (models.Branch) {
      User.belongsTo(models.Branch, {
        foreignKey: 'branchId',
        as: 'Branch',
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      });

      const through = models.UserBranch || models.UserBranches || 'UserBranches';
      User.belongsToMany(models.Branch, {
        through,
        foreignKey: 'userId',
        otherKey: 'branchId',
        as: 'Branches',
      });
    }
  };

  return User;
};
