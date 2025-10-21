'use strict';

module.exports = (sequelize, DataTypes) => {
  const Borrower = sequelize.define(
    'Borrower',
    {
      /* -------- Primary -------- */
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

      /* -------- Names -------- */
      name: { type: DataTypes.STRING, allowNull: false }, // display name (can be first+last or business name)
      firstName: { type: DataTypes.TEXT, allowNull: true },
      lastName:  { type: DataTypes.TEXT, allowNull: true },

      // UX convenience – maps/setter to `name`, getter falls back to first+last if `name` empty
      fullName: {
        type: DataTypes.VIRTUAL,
        get() {
          const n = this.getDataValue('name');
          if (n && String(n).trim().length) return n;
          const fn = this.getDataValue('firstName') || '';
          const ln = this.getDataValue('lastName') || '';
          return `${fn} ${ln}`.trim();
        },
        set(val) {
          this.setDataValue('name', val);
        },
      },

      /* -------- Identity / Contact -------- */
      nationalId: { type: DataTypes.STRING, allowNull: true },
      idNumber:   { type: DataTypes.TEXT,   allowNull: true },
      phone:           { type: DataTypes.STRING, allowNull: true },
      secondaryPhone:  { type: DataTypes.TEXT,   allowNull: true },
      email:           { type: DataTypes.STRING, allowNull: true },

      /* -------- Address -------- */
      address:      { type: DataTypes.STRING, allowNull: true },
      addressLine:  { type: DataTypes.TEXT,   allowNull: true },
      street:       { type: DataTypes.TEXT,   allowNull: true },
      houseNumber:  { type: DataTypes.TEXT,   allowNull: true },
      city:         { type: DataTypes.TEXT,   allowNull: true },
      district:     { type: DataTypes.TEXT,   allowNull: true },
      ward:         { type: DataTypes.TEXT,   allowNull: true },

      /* -------- Org / Relations -------- */
      branchId: { type: DataTypes.INTEGER, allowNull: true }, // DB also has branch_id in some envs
      loanOfficerId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'loan_officer_id',
      },

      /* -------- KYC / Profile -------- */
      gender:               { type: DataTypes.STRING(16), allowNull: true },
      birthDate:            { type: DataTypes.DATEONLY,   allowNull: true },
      employmentStatus:     { type: DataTypes.TEXT,       allowNull: true },
      occupation:           { type: DataTypes.TEXT,       allowNull: true },
      idType:               { type: DataTypes.TEXT,       allowNull: true },
      idIssuedDate:         { type: DataTypes.DATEONLY,   allowNull: true },
      idExpiryDate:         { type: DataTypes.DATEONLY,   allowNull: true },
      nextKinName:          { type: DataTypes.TEXT,       allowNull: true },
      nextKinPhone:         { type: DataTypes.TEXT,       allowNull: true },
      nextOfKinRelationship:{ type: DataTypes.STRING,     allowNull: true },

      /* -------- Business / Extra -------- */
      groupId:        { type: DataTypes.TEXT,        allowNull: true },
      loanType:       { type: DataTypes.TEXT,        allowNull: true, defaultValue: 'individual' },
      regDate:        { type: DataTypes.DATEONLY,    allowNull: true },
      maritalStatus:  { type: DataTypes.STRING(32),  allowNull: true },
      educationLevel: { type: DataTypes.STRING(64),  allowNull: true },
      customerNumber: { type: DataTypes.STRING(64),  allowNull: true },
      tin:            { type: DataTypes.STRING(32),  allowNull: true },
      nationality:    { type: DataTypes.STRING(64),  allowNull: true },

      /* -------- Media -------- */
      photoUrl:         { type: DataTypes.STRING, allowNull: true },
      profilePhotoUrl:  { type: DataTypes.TEXT,   allowNull: true },

      /* -------- Blacklist -------- */
      blacklistReason: { type: DataTypes.TEXT,     allowNull: true },
      blacklistUntil:  { type: DataTypes.DATEONLY, allowNull: true },
      blacklistedAt:   { type: DataTypes.DATE,     allowNull: true },

      /* -------- Status -------- */
      status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'active' },
    },
    {
      tableName: 'Borrowers',
      timestamps: true, // createdAt / updatedAt exist in your table
      indexes: [
        { fields: ['name'] },
        { fields: ['phone'] },
        { fields: ['nationalId'] },
        { fields: ['idNumber'] },
        { fields: ['branchId'] },
        { fields: ['loan_officer_id'] },
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
      });
    }
    if (models.User && !Borrower.associations?.loanOfficer) {
      // Use the MODEL ATTRIBUTE name; `field` mapping keeps DB snake_case
      Borrower.belongsTo(models.User, {
        as: 'loanOfficer',
        foreignKey: 'loanOfficerId',
        targetKey: 'id',
        constraints: false,
      });
    }
  };

  return Borrower;
};
