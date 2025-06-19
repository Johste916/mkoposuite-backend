'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class User extends Model {
    static associate(models) {
      // Relations can be defined here if needed
      User.belongsTo(models.Branch, { foreignKey: 'branchId', as: 'branch' });
    }
  }

  User.init(
    {
      name: {
        type: DataTypes.STRING,
        allowNull: false
      },
      email: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        validate: {
          isEmail: true
        }
      },
      passwordHash: {
        type: DataTypes.STRING,
        allowNull: false,
        field: 'password_hash' // 👈 Matches Supabase's actual column name
      },
      role: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'user'
      },
      branchId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'Branches',
          key: 'id'
        }
      }
    },
    {
      sequelize,
      modelName: 'User',
      tableName: 'Users',         // 👈 explicitly match Supabase table name
      timestamps: true            // includes createdAt & updatedAt
    }
  );

  return User;
};
