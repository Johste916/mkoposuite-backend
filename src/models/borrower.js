// src/models/Borrower.js
module.exports = (sequelize, DataTypes) => {
  const Borrower = sequelize.define('Borrower', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

    // Real DB column is "name"
    name: { type: DataTypes.STRING, allowNull: false, field: 'name' },

    // Optional: virtual alias so existing code using fullName still works
    fullName: {
      type: DataTypes.VIRTUAL,
      get() { return this.getDataValue('name'); },
      set(val) { this.setDataValue('name', val); },
    },

    // Made nullable to avoid blocking first-time captures
    nationalId: { type: DataTypes.STRING, allowNull: true, unique: true },
    phone:      { type: DataTypes.STRING, allowNull: true },
    address:    { type: DataTypes.STRING, allowNull: true },

    // Attribute "branchId" mapped to DB column "branch_id"
    branchId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'branch_id',
    },

    // Present in controllers; keep default here
    status: {
      type: DataTypes.STRING(32),
      allowNull: false,
      defaultValue: 'active',
      field: 'status',
    },
  }, {
    tableName: 'Borrowers',
    timestamps: true,
  });

  // Associations
  Borrower.associate = (models) => {
    if (models.Branch) {
      // Use the attribute name; Sequelize maps it to 'branch_id' column via `field`
      Borrower.belongsTo(models.Branch, { as: 'Branch', foreignKey: 'branchId' });
    }
  };

  return Borrower;
};
