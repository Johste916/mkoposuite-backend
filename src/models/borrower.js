// src/models/borrower.js
'use strict';

module.exports = (sequelize, DataTypes) => {
  const Borrower = sequelize.define(
    'Borrower',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

      // Names
      name:      { type: DataTypes.STRING, allowNull: false, field: 'name' },
      firstName: { type: DataTypes.TEXT,   allowNull: true,  field: 'firstName' },
      lastName:  { type: DataTypes.TEXT,   allowNull: true,  field: 'lastName' },

      fullName: {
        type: DataTypes.VIRTUAL,
        get() {
          const n = (this.getDataValue('name') || '').trim();
          if (n) return n;
          const fn = (this.getDataValue('firstName') || '').trim();
          const ln = (this.getDataValue('lastName') || '').trim();
          return `${fn} ${ln}`.trim();
        },
        set(v) {
          this.setDataValue('name', (v || '').toString().trim());
        },
      },

      // IDs & contacts
      nationalId:     { type: DataTypes.STRING, allowNull: true, field: 'nationalId' },
      idNumber:       { type: DataTypes.TEXT,   allowNull: true, field: 'idNumber' },
      phone:          { type: DataTypes.STRING, allowNull: true, field: 'phone' },
      secondaryPhone: { type: DataTypes.TEXT,   allowNull: true, field: 'secondaryPhone' },
      email:          {
        type: DataTypes.STRING,
        allowNull: true,
        field: 'email',
        validate: { isEmail: { msg: 'Invalid email format' } },
      },

      // Addressing
      address:     { type: DataTypes.STRING, allowNull: true, field: 'address' },
      addressLine: { type: DataTypes.TEXT,   allowNull: true, field: 'addressLine' },
      street:      { type: DataTypes.TEXT,   allowNull: true, field: 'street' },
      houseNumber: { type: DataTypes.TEXT,   allowNull: true, field: 'houseNumber' },
      city:        { type: DataTypes.TEXT,   allowNull: true, field: 'city' },
      district:    { type: DataTypes.TEXT,   allowNull: true, field: 'district' },
      ward:        { type: DataTypes.TEXT,   allowNull: true, field: 'ward' },

      // FKs / tenancy
      branchId:      { type: DataTypes.INTEGER, allowNull: true, field: 'branch_id' },
      loanOfficerId: { type: DataTypes.UUID,    allowNull: true, field: 'loan_officer_id' },
      tenantId:      { type: DataTypes.INTEGER, allowNull: true, field: 'tenant_id' },

      // KYC / profile
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

      // Grouping / misc profile
      groupId:        { type: DataTypes.TEXT,       allowNull: true, field: 'groupId' },
      loanType:       { type: DataTypes.TEXT,       allowNull: true, field: 'loanType', defaultValue: 'individual' },
      regDate:        { type: DataTypes.DATEONLY,   allowNull: true, field: 'regDate' },
      maritalStatus:  { type: DataTypes.STRING(32), allowNull: true, field: 'maritalStatus' },
      educationLevel: { type: DataTypes.STRING(64), allowNull: true, field: 'educationLevel' },
      customerNumber: { type: DataTypes.STRING(64), allowNull: true, field: 'customerNumber' },
      tin:            { type: DataTypes.STRING(32), allowNull: true, field: 'tin' },
      nationality:    { type: DataTypes.STRING(64), allowNull: true, field: 'nationality' },

      // Media
      photoUrl:        { type: DataTypes.STRING, allowNull: true, field: 'photoUrl' },
      profilePhotoUrl: { type: DataTypes.TEXT,   allowNull: true, field: 'profilePhotoUrl' },

      // Blacklist
      blacklistReason: { type: DataTypes.TEXT,     allowNull: true, field: 'blacklistReason' },
      blacklistUntil:  { type: DataTypes.DATEONLY, allowNull: true, field: 'blacklistUntil' },
      blacklistedAt:   { type: DataTypes.DATE,     allowNull: true, field: 'blacklistedAt' },

      // Status
      status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'active', field: 'status' },
    },
    {
      schema: 'public',
      tableName: 'Borrowers',          // ✅ actual table name (capitalized)
      freezeTableName: true,
      timestamps: true,                // createdAt/updatedAt (camel) exist
      underscored: false,
      hooks: {
        beforeValidate(instance) {
          const trim = (v) => (typeof v === 'string' ? v.trim() : v);
          instance.set('name', trim(instance.get('name') || ''));
          instance.set('firstName', trim(instance.get('firstName') || null));
          instance.set('lastName', trim(instance.get('lastName') || null));
          instance.set('email', trim(instance.get('email') || null));
          instance.set('phone', trim(instance.get('phone') || null));
          instance.set('secondaryPhone', trim(instance.get('secondaryPhone') || null));

          if (!instance.get('name')) {
            const fn = instance.get('firstName') || '';
            const ln = instance.get('lastName') || '';
            const composed = `${fn} ${ln}`.trim();
            if (composed) instance.set('name', composed);
          }
        },
      },
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
    if (models.Branch && !Borrower.associations?.branch) {
      Borrower.belongsTo(models.Branch, {
        as: 'branch',
        foreignKey: 'branchId', // maps to DB column branch_id
        targetKey: 'id',
        constraints: false,
      });
    }
    if (models.User && !Borrower.associations?.loanOfficer) {
      Borrower.belongsTo(models.User, {
        as: 'loanOfficer',
        foreignKey: 'loanOfficerId', // UUID; stored as loan_officer_id
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
