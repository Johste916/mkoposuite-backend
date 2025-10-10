'use strict';

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
      password_hash: { type: DataTypes.STRING, allowNull: false },
      password: { type: DataTypes.VIRTUAL }, // write-time only
      role: { type: DataTypes.STRING, defaultValue: 'user' }, // legacy single role alias

      // IMPORTANT: your DB column is camelCase "branchId", not "branch_id"
      // Map the attribute to the actual column name, and keep underscored: false below.
      branchId: { type: DataTypes.INTEGER, allowNull: true, field: 'branchId' },
    },
    {
      tableName: 'Users',
      timestamps: true,

      // Prevent Sequelize from auto-using snake_case columns like "branch_id"
      underscored: false,

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

  // ---- helpers/scopes ----
  User.addScope('withRoles', {
    include: [{ model: sequelize.models.Role, as: 'Roles', through: { attributes: [] } }],
  });

  User.prototype.roleNames = function () {
    const arr = (this.Roles || []).map((r) => (r.name || '').toLowerCase());
    const single = (this.role || '').toLowerCase();
    return Array.from(new Set([...arr, single].filter(Boolean)));
  };

  User.prototype.isRole = function (name) {
    const n = String(name || '').toLowerCase();
    return this.roleNames().includes(n);
    };

  User.prototype.isLoanOfficer = function () {
    return this.isRole('loan officer') || this.isRole('loan_officer') || this.isRole('officer');
  };

  return User;
};
