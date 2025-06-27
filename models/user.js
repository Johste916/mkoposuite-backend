'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class User extends Model {
    static associate(models) {
      // Relation with Branch model
      User.belongsTo(models.Branch, {
        foreignKey: 'branchId',
        as: 'branch'
      });
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
        field: 'password_hash'  // 🔑 matches Supabase column
      },
      role: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'user'
      },
      branchId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: 'branch_id',  // 👈 optional: match Supabase if column is snake_case
        references: {
          model: 'Branches',
          key: 'id'
        }
      }
    },
    {
      sequelize,
      modelName: 'User',
      tableName: 'Users',     // 🔁 Make sure this matches the Supabase table
      timestamps: true        // Includes createdAt and updatedAt
    }
  );

  return User;
};
