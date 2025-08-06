module.exports = (sequelize, DataTypes) => {
  const User = sequelize.define('User', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    email: {
      type: DataTypes.STRING,
      unique: true,
      allowNull: false
    },
    password_hash: {
      type: DataTypes.STRING,
      allowNull: false
    },
    role: {
      type: DataTypes.STRING,
      defaultValue: 'user'
    },
    branchId: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    password: {
      type: DataTypes.VIRTUAL
    }
  }, {
    tableName: 'Users',
    timestamps: true
  });

  User.associate = (models) => {
    User.belongsToMany(models.Role, {
      through: 'UserRoles',
      foreignKey: 'userId'
    });
    User.belongsToMany(models.Branch, {
      through: 'UserBranches',
      foreignKey: 'userId'
    });
  };

  return User;
};
