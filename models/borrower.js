'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class Borrower extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  }
  Borrower.init({
    fullName: DataTypes.STRING,
    nationalId: DataTypes.STRING,
    gender: DataTypes.STRING,
    phone: DataTypes.STRING,
    branchId: DataTypes.INTEGER
  }, {
    sequelize,
    modelName: 'Borrower',
  });
  return Borrower;
};