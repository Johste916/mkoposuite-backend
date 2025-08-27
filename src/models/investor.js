'use strict';
module.exports = (sequelize, DataTypes) => {
  const Investor = sequelize.define('Investor', {
    id:         { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    name:       { type: DataTypes.STRING, allowNull: false },
    email:      { type: DataTypes.STRING },
    phone:      { type: DataTypes.STRING },
    address:    { type: DataTypes.STRING },
    photoUrl:   { type: DataTypes.STRING },
    shares:     { type: DataTypes.DECIMAL(18,2), defaultValue: 0 },
    contributions: { type: DataTypes.DECIMAL(18,2), defaultValue: 0 },
    positions:  { type: DataTypes.JSONB, defaultValue: [] }, // array of strings
    bio:        { type: DataTypes.TEXT },
    notes:      { type: DataTypes.TEXT },
    status:     { type: DataTypes.ENUM('ACTIVE','INACTIVE'), defaultValue: 'ACTIVE' },
  }, {
    tableName: 'investors',
    underscored: true,
  });
  return Investor;
};
