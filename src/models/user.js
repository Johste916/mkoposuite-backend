// models/user.js
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
        unique: true,
        allowNull: false,
      },
      password_hash: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      role: {
        type: DataTypes.STRING,
        defaultValue: 'user',
      },
      branchId: {
        type: DataTypes.INTEGER, // default/home branch (optional)
        allowNull: true,
      },
      password: {
        type: DataTypes.VIRTUAL,
      },
    },
    {
      tableName: 'Users',
      timestamps: true,
      // underscored: true, // enable only if your Users table uses snake_case timestamps
    }
  );

  User.associate = (models) => {
    if (models.Role) {
      User.belongsToMany(models.Role, {
        through: 'UserRoles',
        foreignKey: 'userId',
      });
    }
    if (models.Branch) {
      // many-to-many extra branches via pivot table
      User.belongsToMany(models.Branch, {
        through: 'UserBranches', // 👈 must match UserBranch.tableName above
        foreignKey: 'userId',
      });
      // optional: direct FK to default/home branch
      User.belongsTo(models.Branch, {
        foreignKey: 'branchId',
        as: 'homeBranch',
      });
    }
  };

  return User;
};
