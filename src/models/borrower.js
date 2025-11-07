// src/models/borrower.js
'use strict';

module.exports = (sequelize, DataTypes) => {
  const Borrower = sequelize.define(
    'Borrower',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

      name:      { type: DataTypes.STRING, allowNull: false, field: 'name' },
      firstName: { type: DataTypes.TEXT,   allowNull: true,  field: 'firstName' },
      lastName:  { type: DataTypes.TEXT,   allowNull: true,  field: 'lastName' },

      fullName: {
        type: DataTypes.VIRTUAL,
        get() {
          const n = this.getDataValue('name');
          if (n && String(n).trim()) return n;
          const fn = this.getDataValue('firstName') || '';
          const ln = this.getDataValue('lastName') || '';
          return `${fn} ${ln}`.trim();
        },
        set(v) { this.setDataValue('name', v); },
      },

      nationalId:     { type: DataTypes.STRING, allowNull: true, field: 'nationalId' },
      idNumber:       { type: DataTypes.TEXT,   allowNull: true, field: 'idNumber' },
      phone:          { type: DataTypes.STRING, allowNull: true, field: 'phone' },
      secondaryPhone: { type: DataTypes.TEXT,   allowNull: true, field: 'secondaryPhone' },
      email:          { type: DataTypes.STRING, allowNull: true, field: 'email' },

      address:     { type: DataTypes.STRING, allowNull: true, field: 'address' },
      addressLine: { type: DataTypes.TEXT,   allowNull: true, field: 'addressLine' },
      street:      { type: DataTypes.TEXT,   allowNull: true, field: 'street' },
      houseNumber: { type: DataTypes.TEXT,   allowNull: true, field: 'houseNumber' },
      city:        { type: DataTypes.TEXT,   allowNull: true, field: 'city' },
      district:    { type: DataTypes.TEXT,   allowNull: true, field: 'district' },
      ward:        { type: DataTypes.TEXT,   allowNull: true, field: 'ward' },

      branchId:      { type: DataTypes.INTEGER, allowNull: true, field: 'branch_id' },
      loanOfficerId: { type: DataTypes.UUID,    allowNull: true, field: 'loan_officer_id' },
      tenantId:      { type: DataTypes.INTEGER, allowNull: true, field: 'tenant_id' },

      gender:               { type: DataTypes.STRING(16), allowNull: true, field: 'gender' },
      birthDate:            { type: DataTypes.DATEONLY,   allowNull: true, field: 'birthDate' },
      employmentStatus:     { type: DataTypes.TEXT,       allowNull: true, field: 'employmentStatus' },
      occupation:           { type: DataTypes.TEXT,       allowNull: true, field: 'occupation' },
      idType:               { type: DataTypes.TEXT,       allowNull: true, field: 'idType' },
      idIssuedDate:         { type: DataTypes.DATEONLY,   allowNull: true, field: 'idIssuedDate' },
      idExpiryDate:         { type: DataTypes.DATEONLY,   allowNull: true, field: 'idExpiryDate' },
      nextKinName:          { type: DataTypes.TEXT,       allowNull: true, field: 'nextKinName' },
      nextKinPhone:         { type: DataTypes.TEXT,       allowNull: true, field: 'nextKinPhone' },
      nextOfKinRelationship:{ type: DataTypes.STRING,     allowNull: true, field: 'nextOfKinRelationship' },

      groupId:        { type: DataTypes.TEXT,       allowNull: true, field: 'groupId' },
      loanType:       { type: DataTypes.TEXT,       allowNull: true, field: 'loanType', defaultValue: 'individual' },
      regDate:        { type: DataTypes.DATEONLY,   allowNull: true, field: 'regDate' },
      maritalStatus:  { type: DataTypes.STRING(32), allowNull: true, field: 'maritalStatus' },
      educationLevel: { type: DataTypes.STRING(64), allowNull: true, field: 'educationLevel' },
      customerNumber: { type: DataTypes.STRING(64), allowNull: true, field: 'customerNumber' },
      tin:            { type: DataTypes.STRING(32), allowNull: true, field: 'tin' },
      nationality:    { type: DataTypes.STRING(64), allowNull: true, field: 'nationality' },

      photoUrl:        { type: DataTypes.STRING, allowNull: true, field: 'photoUrl' },
      profilePhotoUrl: { type: DataTypes.TEXT,   allowNull: true, field: 'profilePhotoUrl' },

      blacklistReason: { type: DataTypes.TEXT,     allowNull: true, field: 'blacklistReason' },
      blacklistUntil:  { type: DataTypes.DATEONLY, allowNull: true, field: 'blacklistUntil' },
      blacklistedAt:   { type: DataTypes.DATE,     allowNull: true, field: 'blacklistedAt' },

      status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'active', field: 'status' },
    },
    {
      schema: 'public',
      tableName: 'Borrowers',          // keep existing cased table name
      freezeTableName: true,
      timestamps: true,                // createdAt/updatedAt (camel) exist
      underscored: false,
      indexes: [
        { fields: ['name'] },
        { fields: ['phone'] },
        { fields: ['nationalId'] },
        { fields: ['idNumber'] },
        { fields: ['branch_id'] },
        { fields: ['loan_officer_id'] },
        { fields: ['tenant_id'] },
        { fields: ['status'] },
        { fields: ['blacklistedAt'] },
      ],
    }
  );

  Borrower.associate = (models) => {
    if (models.Branch && !Borrower.associations?.Branch) {
      Borrower.belongsTo(models.Branch, {
        as: 'Branch',
        foreignKey: 'branchId',
        targetKey: 'id',
        constraints: false,
      });
    }
    if (models.User && !Borrower.associations?.loanOfficer) {
      Borrower.belongsTo(models.User, {
        as: 'loanOfficer',
        foreignKey: 'loanOfficerId',
        targetKey: 'id',
        constraints: false,
      });
    }
    if (models.Loan && !Borrower.associations?.Loans) {
      Borrower.hasMany(models.Loan, {
        as: 'Loans',
        foreignKey: 'borrowerId',
        sourceKey: 'id',
        constraints: false,
      });
    }
  };

  return Borrower;
};
