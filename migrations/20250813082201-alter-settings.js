// backend/src/migrations/20250813082201-alter-settings.js
'use strict';

const tableName = 'settings';
const altNames = ['Settings']; // older projects sometimes used PascalCase

async function hasTable(qi, name, schema) {
  try {
    if (schema && qi.sequelize.getDialect() === 'postgres') {
      await qi.describeTable({ tableName: name, schema });
    } else {
      await qi.describeTable(name);
    }
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const dialect = queryInterface.sequelize.getDialect();
    const schema =
      dialect === 'postgres'
        ? process.env.DB_SCHEMA || 'public'
        : undefined;

    // 1) If an old "Settings" table exists, rename it to "settings"
    for (const oldName of altNames) {
      if (await hasTable(queryInterface, oldName, schema)) {
        await queryInterface.renameTable(oldName, tableName);
        break;
      }
    }

    // 2) If settings table does not exist, create it
    if (!(await hasTable(queryInterface, tableName, schema))) {
      await queryInterface.createTable(tableName, {
        key: {
          type: Sequelize.STRING,
          allowNull: false,
          unique: true,
        },
        value: {
          type:
            dialect === 'postgres'
              ? Sequelize.JSONB
              : Sequelize.JSON,
          allowNull: false,
          defaultValue: {},
        },
        description: {
          type: Sequelize.STRING,
          allowNull: true,
          defaultValue: '',
        },
        updatedBy: {
          type: Sequelize.UUID,
          allowNull: true,
        },
        createdAt: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue:
            dialect === 'postgres'
              ? Sequelize.fn('NOW')
              : Sequelize.literal('CURRENT_TIMESTAMP'),
        },
        updatedAt: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue:
            dialect === 'postgres'
              ? Sequelize.fn('NOW')
              : Sequelize.literal('CURRENT_TIMESTAMP'),
        },
      });
      return;
    }

    // 3) Table exists — ensure columns match our expectations
    const desc = schema && dialect === 'postgres'
      ? await queryInterface.describeTable({ tableName, schema })
      : await queryInterface.describeTable(tableName);

    // value as JSON/JSONB
    const valueCol = (desc.value?.type || '').toLowerCase();
    const needsJson =
      !valueCol.includes('json'); // covers json/jsonb

    if (needsJson) {
      await queryInterface.changeColumn(
        tableName,
        'value',
        {
          type:
            dialect === 'postgres'
              ? Sequelize.JSONB
              : Sequelize.JSON,
          allowNull: false,
          defaultValue: {},
        }
      );
    }

    // description column
    if (!desc.description) {
      await queryInterface.addColumn(tableName, 'description', {
        type: Sequelize.STRING,
        allowNull: true,
        defaultValue: '',
      });
    }

    // updatedBy column
    if (!desc.updatedBy) {
      await queryInterface.addColumn(tableName, 'updatedBy', {
        type: Sequelize.UUID,
        allowNull: true,
      });
    }
  },

  async down(queryInterface /*, Sequelize */) {
    // Safe revert: just remove the columns we added. We do NOT drop the table.
    if (await hasTable(queryInterface, tableName)) {
      const desc = await queryInterface.describeTable(tableName);
      if (desc.updatedBy) {
        await queryInterface.removeColumn(tableName, 'updatedBy');
      }
      if (desc.description) {
        await queryInterface.removeColumn(tableName, 'description');
      }
      // We deliberately leave `value` as JSON/JSONB.
    }
  },
};
