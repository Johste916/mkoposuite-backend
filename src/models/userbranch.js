// models/UserBranch.js
module.exports = (sequelize, DataTypes) => {
  const UserBranch = sequelize.define(
    'UserBranch',
    {
      userId: {
        type: DataTypes.UUID,         // 👈 match Users.id (UUID)
        allowNull: false,
      },
      branchId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
    },
    {
      tableName: 'UserBranches',      // 👈 keep the exact through table your User model references
      timestamps: true,               // if your table has createdAt/updatedAt
      // underscored: true,           // enable only if the physical table uses created_at/updated_at
      indexes: [
        { unique: true, fields: ['userId', 'branchId'] }, // prevent duplicates
        { fields: ['branchId'] },
      ],
    }
  );

  UserBranch.associate = (models) => {
    if (models.User) {
      UserBranch.belongsTo(models.User, {
        foreignKey: 'userId',
        onDelete: 'CASCADE',
      });
    }
    if (models.Branch) {
      UserBranch.belongsTo(models.Branch, {
        foreignKey: 'branchId',
        onDelete: 'CASCADE',
      });
    }
  };

  return UserBranch;
};
