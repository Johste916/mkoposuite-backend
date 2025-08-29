'use strict';
module.exports = (sequelize, DataTypes) => {
  const { Model } = require('sequelize');
  class FeatureConfig extends Model {}
  FeatureConfig.init({
    companyId: DataTypes.UUID,
    key: DataTypes.STRING,
    value: DataTypes.JSONB,
  }, { sequelize, modelName: 'FeatureConfig', tableName: 'FeatureConfigs' });
  return FeatureConfig;
};
