// src/models/Borrower.js
module.exports = (sequelize, DataTypes) => {
  const Borrower = sequelize.define('Borrower', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },

    // Real DB column is "name"
    name: {
      type: DataTypes.STRING,
      allowNull: false,
      field: 'name',
    },

    // Optional: virtual alias so existing code using fullName still works
    fullName: {
      type: DataTypes.VIRTUAL,
      get() {
        return this.getDataValue('name');
      },
      set(val) {
        // writing to fullName will store in name
        this.setDataValue('name', val);
      },
    },

    nationalId: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    phone: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    address: {
      type: DataTypes.STRING,
      allowNull: true,
    },

    // ✅ Model attribute uses camelCase; DB column uses snake_case (branch_id)
    //    Keep allowNull true to avoid breaking existing rows until backfilled.
    branchId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'branch_id',
    },
  }, {
    tableName: 'Borrowers',  // matches your DB (per your inspection)
    timestamps: true,
  });

  // (Optional) Association helper. Index wiring already covers this, but harmless to keep.
  Borrower.associate = (models) => {
    if (models.Branch) {
      Borrower.belongsTo(models.Branch, { as: 'Branch', foreignKey: 'branchId' });
    }
  };

  return Borrower;
};
