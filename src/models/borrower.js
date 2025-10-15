'use strict';

module.exports = (sequelize, DataTypes) => {
  const Borrower = sequelize.define(
    'Borrower',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

      name: { type: DataTypes.STRING, allowNull: false },

      // UX convenience – maps to `name`
      fullName: {
        type: DataTypes.VIRTUAL,
        get() {
          return this.getDataValue('name');
        },
        set(val) {
          this.setDataValue('name', val);
        },
      },

      nationalId: { type: DataTypes.STRING, allowNull: true },
      phone:      { type: DataTypes.STRING, allowNull: true },
      email:      { type: DataTypes.STRING, allowNull: true },
      address:    { type: DataTypes.STRING, allowNull: true },

      // DB columns (keep snake-case mapping where needed)
      branchId:      { type: DataTypes.INTEGER, allowNull: true },
      loanOfficerId: { type: DataTypes.UUID, allowNull: true, field: 'loan_officer_id' },

      // KYC / profile
      gender:               { type: DataTypes.STRING(16), allowNull: true },
      birthDate:            { type: DataTypes.DATEONLY, allowNull: true },
      employmentStatus:     { type: DataTypes.STRING(32), allowNull: true },
      occupation:           { type: DataTypes.STRING, allowNull: true },
      idType:               { type: DataTypes.STRING(32), allowNull: true },
      idIssuedDate:         { type: DataTypes.DATEONLY, allowNull: true },
      idExpiryDate:         { type: DataTypes.DATEONLY, allowNull: true },
      nextKinName:          { type: DataTypes.STRING, allowNull: true },
      nextKinPhone:         { type: DataTypes.STRING, allowNull: true },
      nextOfKinRelationship:{ type: DataTypes.STRING, allowNull: true },

      // additional fields used by FE
      groupId:        { type: DataTypes.STRING, allowNull: true },
      loanType:       { type: DataTypes.STRING(32), allowNull: true, defaultValue: 'individual' },
      regDate:        { type: DataTypes.DATEONLY, allowNull: true },
      maritalStatus:  { type: DataTypes.STRING(32), allowNull: true },
      educationLevel: { type: DataTypes.STRING(64), allowNull: true },
      customerNumber: { type: DataTypes.STRING(64), allowNull: true },
      tin:            { type: DataTypes.STRING(32), allowNull: true },
      nationality:    { type: DataTypes.STRING(64), allowNull: true },

      photoUrl:       { type: DataTypes.STRING, allowNull: true },

      status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'active' },
    },
    {
      tableName: 'Borrowers',
      timestamps: true,
      indexes: [
        { fields: ['name'] },
        { fields: ['phone'] },
        { fields: ['nationalId'] },
        { fields: ['branchId'] },
        { fields: ['loan_officer_id'] },
        { fields: ['status'] },
      ],
    }
  );

  Borrower.associate = (models) => {
    if (models.Branch && !Borrower.associations?.Branch) {
      Borrower.belongsTo(models.Branch, {
        as: 'Branch',
        foreignKey: 'branchId',
        targetKey: 'id',
      });
    }
    if (models.User && !Borrower.associations?.loanOfficer) {
      // Use the MODEL ATTRIBUTE name; `field` mapping takes care of snake_case in DB
      Borrower.belongsTo(models.User, {
        as: 'loanOfficer',
        foreignKey: 'loanOfficerId',
        targetKey: 'id',
        constraints: false, // keep flexible across envs
      });
    }
  };

  return Borrower;
};
