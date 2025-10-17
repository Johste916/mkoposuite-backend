'use strict';

const bcrypt = require('bcryptjs');

module.exports = (sequelize, DataTypes) => {
  const User = sequelize.define(
    'User',
    {
      id:   { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      name: { type: DataTypes.STRING, allowNull: false },

      email: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        validate: { isEmail: true },
      },

      password_hash: { type: DataTypes.STRING, allowNull: false },

      password: {
        type: DataTypes.VIRTUAL,
        set(value) { this.setDataValue('password', value); },
        validate: { len: { args: [6, 100], msg: 'Password must be at least 6 characters long.' } },
      },

      // Primary role (FK → roles.id)
      roleId: { type: DataTypes.UUID, allowNull: true, field: 'role_id' },

      // Branch (FK) if you have branches table
      branchId: { type: DataTypes.INTEGER, allowNull: true, field: 'branch_id' },

      status: { type: DataTypes.ENUM('active', 'inactive'), defaultValue: 'active' },

      // (Optional) legacy string field; keep only if you still read it elsewhere.
      // role: { type: DataTypes.STRING, defaultValue: 'user' },
    },
    {
      tableName: 'users',
      underscored: true,
      timestamps: true,
      defaultScope: { attributes: { exclude: ['password_hash'] } },
      hooks: {
        async beforeSave(user) {
          const plain = user.getDataValue('password');
          if (plain) {
            const salt = await bcrypt.genSalt(10);
            user.password_hash = await bcrypt.hash(plain, salt);
          }
        },
      },
    }
  );

  User.associate = (models) => {
    // Primary role (one role via users.role_id)
    if (models.Role) {
      User.belongsTo(models.Role, { foreignKey: 'roleId', targetKey: 'id', as: 'role' });

      // Multi-role (M:N via user_roles)
      User.belongsToMany(models.Role, {
        through: models.UserRole || 'user_roles',
        foreignKey: 'userId',
        otherKey: 'roleId',
        as: 'roles',
      });
    }

    if (models.Branch) {
      User.belongsTo(models.Branch, {
        foreignKey: 'branchId',
        targetKey: 'id',
        as: 'branch',
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      });

      // Optional multi-branch legacy support if you keep a join table
      const through = models.UserBranch || models.UserBranches || 'user_branches';
      User.belongsToMany(models.Branch, {
        through,
        foreignKey: 'userId',
        otherKey: 'branchId',
        as: 'branches',
      });
    }
  };

  User.prototype.toJSON = function () {
    const obj = { ...this.get() };
    delete obj.password_hash;
    return obj;
  };

  User.prototype.checkPassword = async function (password) {
    return bcrypt.compare(password, this.password_hash);
  };

  return User;
};
