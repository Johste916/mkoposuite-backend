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

    nationalId: { type: DataTypes.STRING, allowNull: false, unique: true },
    phone:      { type: DataTypes.STRING, allowNull: false },
    address:    { type: DataTypes.STRING, allowNull: true },

    // ✅ Map camelCase attribute to snake_case DB column if you added it that way
    // If your DB column is "branch_id", keep field:'branch_id'.
    // If you migrated a camel column "branchId", change field to 'branchId'.
    branchId: {
      type: DataTypes.INTEGER,
      allowNull: true,          // keep loose to avoid breaking inserts that don't set it
      field: 'branch_id',       // <-- matches your earlier mapping
    },

    // ✅ NEW: status column your controllers expect
    status: {
      type: DataTypes.STRING(32),
      allowNull: false,
      defaultValue: 'active',   // rows created before the migration will read as 'active'
      field: 'status',
    },
  }, {
    tableName: 'Borrowers',     // matches your DB table name with capital B
    timestamps: true,
  });

  // Associations (unchanged)
  Borrower.associate = (models) => {
    if (models.Branch) {
      // Uses the physical DB column name
      Borrower.belongsTo(models.Branch, { as: 'Branch', foreignKey: 'branch_id' });
    }
  };

  return Borrower;
};
