'use strict';

const bcrypt = require('bcryptjs');

module.exports = (sequelize, DataTypes) => {
  const User = sequelize.define(
    'User',
    {
      id:    { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      name:  { type: DataTypes.STRING, allowNull: false },
      email: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        validate: { isEmail: true },
      },
      // DB column is snake, attribute is snake (fine)
      password_hash: { type: DataTypes.STRING, allowNull: false },
      // virtual setter for raw passwords
      password: {
        type: DataTypes.VIRTUAL,
        set(value) { this.setDataValue('password', value); },
        validate: { len: { args: [6, 100], msg: 'Password must be at least 6 characters long.' } },
      },

      role:     { type: DataTypes.STRING, defaultValue: 'user' }, // legacy
      branchId: { type: DataTypes.INTEGER, allowNull: true },
      status:   { type: DataTypes.ENUM('active', 'inactive'), defaultValue: 'active' },
    },
    {
      tableName: 'Users',
      timestamps: true,
      underscored: false, // this table uses camel timestamps
      defaultScope: { attributes: { exclude: ['password_hash'] } },
      indexes: [{ unique: true, fields: ['email'] }],
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
    if (models.Role && !User.associations?.Roles) {
      User.belongsToMany(models.Role, {
        through: models.UserRole || 'UserRoles',
        foreignKey: 'userId',
        otherKey: 'roleId',
        as: 'Roles',
      });
    }

    if (models.Branch && !User.associations?.Branch) {
      User.belongsTo(models.Branch, {
        foreignKey: 'branchId',
        as: 'Branch',
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      });

      const through = models.UserBranch || models.UserBranches || 'UserBranches';
      if (!User.associations?.Branches) {
        User.belongsToMany(models.Branch, {
          through,
          foreignKey: 'userId',
          otherKey: 'branchId',
          as: 'Branches',
        });
      }
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
