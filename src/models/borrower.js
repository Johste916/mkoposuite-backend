// src/models/Borrower.js
module.exports = (sequelize, DataTypes) => {
  const Borrower = sequelize.define('Borrower', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

    // Display name used everywhere
    name: { type: DataTypes.STRING, allowNull: false, field: 'name' },

    // Virtual alias to keep older code that reads/writes `fullName` working
    fullName: {
      type: DataTypes.VIRTUAL,
      get() { return this.getDataValue('name'); },
      set(val) { this.setDataValue('name', val); },
    },

    // Core identifiers & contacts
    nationalId:   { type: DataTypes.STRING, allowNull: true, unique: true },
    phone:        { type: DataTypes.STRING, allowNull: true },
    email:        { type: DataTypes.STRING, allowNull: true },
    address:      { type: DataTypes.STRING, allowNull: true },

    // Assignment
    branchId:     { type: DataTypes.INTEGER, allowNull: true, field: 'branch_id' },
    loanOfficerId:{ type: DataTypes.INTEGER, allowNull: true },

    // KYC / personal
    gender:             { type: DataTypes.STRING(16), allowNull: true },
    birthDate:          { type: DataTypes.DATEONLY, allowNull: true },
    employmentStatus:   { type: DataTypes.STRING(32), allowNull: true },
    occupation:         { type: DataTypes.STRING, allowNull: true },
    idType:             { type: DataTypes.STRING(32), allowNull: true },
    idIssuedDate:       { type: DataTypes.DATEONLY, allowNull: true },
    idExpiryDate:       { type: DataTypes.DATEONLY, allowNull: true },
    nextKinName:        { type: DataTypes.STRING, allowNull: true },
    nextKinPhone:       { type: DataTypes.STRING, allowNull: true },
    nextOfKinRelationship: { type: DataTypes.STRING, allowNull: true },

    // Business/ops metadata used in UI
    groupId:       { type: DataTypes.INTEGER, allowNull: true },
    loanType:      { type: DataTypes.STRING(32), allowNull: true },
    regDate:       { type: DataTypes.DATEONLY, allowNull: true },
    maritalStatus: { type: DataTypes.STRING(32), allowNull: true },
    educationLevel:{ type: DataTypes.STRING(64), allowNull: true },
    customerNumber:{ type: DataTypes.STRING(64), allowNull: true },
    tin:           { type: DataTypes.STRING(32), allowNull: true },
    nationality:   { type: DataTypes.STRING(64), allowNull: true },

    // Optional profile photo (controller writes it if present)
    photoUrl:      { type: DataTypes.STRING, allowNull: true },

    // Status (existing behaviour preserved)
    status:        { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'active', field: 'status' },
  }, {
    tableName: 'Borrowers',
    timestamps: true,
  });

  Borrower.associate = (models) => {
    if (models.Branch) {
      Borrower.belongsTo(models.Branch, { as: 'Branch', foreignKey: 'branchId' });
    }
    if (models.User) {
      Borrower.belongsTo(models.User, { as: 'loanOfficer', foreignKey: 'loanOfficerId' });
    }
  };

  return Borrower;
};
