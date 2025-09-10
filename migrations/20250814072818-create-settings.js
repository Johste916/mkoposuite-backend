'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const dialect = queryInterface.sequelize.getDialect();
    const JSON_TYPE = dialect === 'postgres' ? Sequelize.JSONB : Sequelize.JSON;

    await queryInterface.createTable('settings', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal(
          dialect === 'postgres' ? 'gen_random_uuid()' : 'uuid()'
        ),
        allowNull: false,
        primaryKey: true,
      },
      key: {
        type: Sequelize.STRING(200),
        allowNull: false,
        unique: true,
      },
      value: {
        type: JSON_TYPE,
        allowNull: false,
        defaultValue: dialect === 'postgres' ? Sequelize.literal(`'{}'::jsonb`) : {},
      },
      description: {
        type: Sequelize.STRING(500),
        allowNull: false,
        defaultValue: '',
      },
      createdBy: { type: Sequelize.UUID, allowNull: true },
      updatedBy: { type: Sequelize.UUID, allowNull: true },
      createdAt: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('NOW()') },
      updatedAt: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('NOW()') },
    });

    await queryInterface.addIndex('settings', ['key'], { unique: true });

    if (dialect === 'postgres') {
      await queryInterface.sequelize.query(
        'CREATE INDEX IF NOT EXISTS settings_value_gin_idx ON "settings" USING GIN ("value");'
      );
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('settings');
  },
};
