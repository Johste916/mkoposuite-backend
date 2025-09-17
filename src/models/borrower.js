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

    // ✅ Map camelCase attribute to snake_case DB column
    branchId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'branch_id',
    },
  }, {
    tableName: 'Borrowers',  // matches your DB (per the error log)
    timestamps: true,
  });

  // ✅ Non-breaking: add association so includes work when available
  Borrower.associate = (models) => {
    if (models.Branch) {
      Borrower.belongsTo(models.Branch, { as: 'Branch', foreignKey: 'branch_id' });
    }
  };

  return Borrower;
};
