'use strict';

module.exports = (sequelize, DataTypes) => {
  const UserBranch = sequelize.define(
    'UserBranch',
    {
      userId: { type: DataTypes.UUID, allowNull: false, field: 'user_id' },
      branchId: { type: DataTypes.INTEGER, allowNull: false, field: 'branch_id' },
    },
    {
      tableName: 'user_branches_rt',
      schema: 'public',
      timestamps: true,
      underscored: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      indexes: [
        { unique: true, fields: ['user_id', 'branch_id'] },
        { fields: ['branch_id'] },
      ],
    }
  );

  UserBranch.associate = (models) => {
    if (models.User) {
      UserBranch.belongsTo(models.User, { foreignKey: 'user_id', targetKey: 'id' });
    }
    if (models.Branch) {
      UserBranch.belongsTo(models.Branch, { foreignKey: 'branch_id', targetKey: 'id' });
    }
  };

  return UserBranch;
};
