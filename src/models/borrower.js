// models/borrower.js
module.exports = (sequelize, DataTypes) => {
  const Borrower = sequelize.define(
    "Borrower",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },

      name: {
        type: DataTypes.STRING,
        allowNull: false,
      },

      // keep using fullName virtually for legacy code
      fullName: {
        type: DataTypes.VIRTUAL,
        get() { return this.getDataValue("name"); },
        set(val) { this.setDataValue("name", val); },
      },

      nationalId: {
        type: DataTypes.STRING,
        allowNull: true,
        unique: false, // set true only if DB enforces it
      },

      phone: {
        type: DataTypes.STRING,
        allowNull: true,
      },

      email: {
        type: DataTypes.STRING,
        allowNull: true,
      },

      address: {
        type: DataTypes.STRING,
        allowNull: true,
      },

      branchId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },

      status: {
        type: DataTypes.STRING, // 'active' | 'blacklisted' | 'pending_kyc' | ...
        allowNull: true,
      },
    },
    {
      tableName: "Borrowers",    // matches your DB
      timestamps: true,          // Add Borrower works => table should have createdAt/updatedAt
      // underscored: false,     // keep camelCase column names for this table
      indexes: [
        { fields: ["branchId"] },
        { fields: ["status"] },
        { fields: ["name"] },
      ],
    }
  );

  return Borrower;
};
