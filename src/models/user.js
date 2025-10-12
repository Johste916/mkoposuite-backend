'use strict';

const bcrypt = require('bcryptjs');

module.exports = (sequelize, DataTypes) => {
  const User = sequelize.define(
    'User',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      name: { type: DataTypes.STRING, allowNull: false },
      email: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        validate: { isEmail: true },
      },
      // DB column is TEXT; STRING works fine here
      password_hash: { type: DataTypes.STRING, allowNull: false },

      // write-time only (not stored)
      password: {
        type: DataTypes.VIRTUAL,
        set(value) {
          this.setDataValue('password', value);
        },
        validate: {
          len: {
            args: [6, 100],
            msg: 'Password must be at least 6 characters long.',
          },
        },
      },

      role: { type: DataTypes.STRING, defaultValue: 'user' },
      branchId: { type: DataTypes.INTEGER, allowNull: true, field: 'branchId' },

      // Add because controller supports toggleStatus() via "status"
      status: {
        type: DataTypes.ENUM('active', 'inactive'),
        defaultValue: 'active',
      },
    },
    {
      tableName: 'Users',
      timestamps: true,
      underscored: false,

      defaultScope: {
        attributes: { exclude: ['password_hash'] },
      },

      hooks: {
        async beforeSave(user) {
          // Hash only when a plain password is provided
          const plain = user.getDataValue('password');
          if (plain) {
            const salt = await bcrypt.genSalt(10);
            user.password_hash = await bcrypt.hash(plain, salt);
          }
        },
      },
    }
  );

  // Associations
  User.associate = (models) => {
    if (models.Role) {
      User.belongsToMany(models.Role, {
        through: models.UserRole || 'UserRoles',
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
