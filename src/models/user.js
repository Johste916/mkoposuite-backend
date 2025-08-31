// models/user.js
'use strict';

module.exports = (sequelize, DataTypes) => {
  const User = sequelize.define(
    'User',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      email: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        validate: { isEmail: true },
      },
      password_hash: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      // Optional virtual for write-time only
      password: {
        type: DataTypes.VIRTUAL,
      },
      role: {
        type: DataTypes.STRING,
        defaultValue: 'user',
      },
      // Optional direct FK to a user's default/home branch
      branchId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
    },
    {
      tableName: 'Users',          // your existing table name
      timestamps: true,            // uses createdAt/updatedAt (camelCase)
      // paranoid: true,           // <-- enable ONLY if Users has a 'deletedAt' column
      // deletedAt: 'deletedAt',   // (leave commented unless the column exists)
      // underscored: false,       // keep camelCase timestamps for this table
      defaultScope: {
        attributes: { exclude: ['password_hash'] },
      },
      scopes: {
        withSensitive: {}, // opt-in scope if you need password_hash explicitly
      },
    }
  );

  // Clean JSON output (hides password_hash even if a custom scope is used)
  User.prototype.toJSON = function () {
    const obj = { ...this.get() };
    delete obj.password_hash;
    return obj;
  };

  User.associate = (models) => {
    // ----- Roles (many-to-many) -----
    if (models.Role) {
      User.belongsToMany(models.Role, {
        through: 'UserRoles',
        foreignKey: 'userId',
        otherKey: 'roleId',
        as: 'Roles',
      });
    }

    // ----- Branch relations -----
    if (models.Branch) {
      // 1) Default/home branch — IMPORTANT: alias must be 'Branch'
      //    so includes like { model: Branch, as: 'Branch' } work.
      User.belongsTo(models.Branch, {
        foreignKey: 'branchId',
        as: 'Branch',               // <— align with your includes
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      });

      // 2) Extra branches (many-to-many)
      // Use existing join model if present; else fall back to table name.
      const through =
        models.UserBranch ||
        models.UserBranches ||
        'UserBranches';

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
