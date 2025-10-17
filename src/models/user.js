'use strict';
const bcrypt = require('bcryptjs');

module.exports = (sequelize, DataTypes) => {
  const User = sequelize.define('User', {
    id:            { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    name:          { type: DataTypes.STRING, allowNull: false },
    email:         { type: DataTypes.STRING, allowNull: false, unique: true, validate: { isEmail: true } },
    password_hash: { type: DataTypes.STRING, allowNull: true }, // view may omit it; keep nullable
    password: {
      type: DataTypes.VIRTUAL,
      set(v) { this.setDataValue('password', v); },
      validate: { len: { args: [6, 100], msg: 'Password must be at least 6 characters long.' } },
    },
    role:     { type: DataTypes.STRING, defaultValue: 'user' }, // legacy convenience
    branchId: { type: DataTypes.UUID, allowNull: true, field: 'branchId' }, // 👈 important: camelCase field in DB
    status:   { type: DataTypes.ENUM('active', 'inactive'), defaultValue: 'active' },
  }, {
    tableName: 'users',          // 👈 your DB object is lower-case
    underscored: false,          // prevent auto snake_case
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
  });

  User.associate = (models) => {
    if (models.Role) {
      User.belongsToMany(models.Role, {
        through: models.UserRole || 'user_roles',
        foreignKey: { name: 'userId', field: 'user_id' },
        otherKey:   { name: 'roleId', field: 'role_id' },
        as: 'Roles',
      });
    }
    if (models.Branch) {
      User.belongsTo(models.Branch, {
        as: 'Branch',
        foreignKey: { name: 'branchId', field: 'branchId' }, // 👈 match DB column
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      });
    }
  };

  User.prototype.toJSON = function () { const o = { ...this.get() }; delete o.password_hash; return o; };
  User.prototype.checkPassword = async function (password) { return bcrypt.compare(password, this.password_hash || ''); };

  return User;
};
