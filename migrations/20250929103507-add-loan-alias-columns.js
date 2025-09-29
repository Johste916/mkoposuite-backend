"use strict";

/**
 * Add camelCase alias columns to "loans" that read from existing snake_case columns.
 * This fixes errors like: column "approvalDate" does not exist (but approval_date does).
 * Uses GENERATED ALWAYS AS (...) STORED so writes still go to snake_case.
 */

function resolveArgs(args) {
  if (args.length === 2 && args[0]?.sequelize) {
    const [qi, Sequelize] = args;
    return { qi, sequelize: qi.sequelize, Sequelize };
  }
  if (args.length === 1 && args[0]?.context) {
    const { context: qi, Sequelize } = args[0];
    return { qi, sequelize: qi.sequelize, Sequelize };
  }
  const qi = args[0];
  return { qi, sequelize: qi?.sequelize, Sequelize: require("sequelize") };
}

async function describeSafe(qi, table) {
  try { return await qi.describeTable(table); } catch { return null; }
}

async function hasColumn(qi, table, col) {
  const d = await describeSafe(qi, table);
  return !!d?.[col];
}

async function addGeneratedAliasIfMissing({ qi, sequelize }, table, camel, snake) {
  const existsCamel = await hasColumn(qi, table, camel);
  const existsSnake = await hasColumn(qi, table, snake);
  if (existsCamel || !existsSnake) return false;

  // Infer SQL type from the snake column
  const d = await qi.describeTable(table);
  const t = (d[snake]?.type || "TEXT").toUpperCase();

  // Minimal normalization of sequelize's type string to PG types
  // Examples from describeTable: 'INTEGER', 'BIGINT', 'DATE', 'TIMESTAMP WITH TIME ZONE', 'CHARACTER VARYING(255)', 'NUMERIC'
  const typeSQL = t
    .replace("TIMESTAMP WITH TIME ZONE", "TIMESTAMPTZ")
    .replace("TIMESTAMP WITHOUT TIME ZONE", "TIMESTAMP");

  const sql = `ALTER TABLE "public"."${table}"
    ADD COLUMN "${camel}" ${typeSQL} GENERATED ALWAYS AS ("${snake}") STORED;`;
  await sequelize.query(sql);
  return true;
}

const TABLE = "loans";
const MAP = [
  // camelCase   ->  snake_case
  ["approvalDate",       "approval_date"],
  ["rejectionDate",      "rejection_date"],
  ["disbursementDate",   "disbursement_date"],
  ["closedDate",         "closed_date"],           // not always needed, but safe
  ["closeReason",        "close_reason"],
  ["rescheduledFromId",  "rescheduled_from_id"],
  ["topUpOfId",          "top_up_of_id"],
  ["branchId",           "branch_id"],
  ["productId",          "product_id"],
  ["termMonths",         "term_months"],
  // if you have created_at/updated_at and NOT createdAt/updatedAt, you can alias too:
  // ["createdAt",       "created_at"],
  // ["updatedAt",       "updated_at"],
];

const ADDED = [];

module.exports = {
  async up(...args) {
    const ctx = resolveArgs(args);
    // Make sure the table exists
    const d = await describeSafe(ctx.qi, TABLE);
    if (!d) throw new Error(`Table "${TABLE}" not found.`);

    for (const [camel, snake] of MAP) {
      const added = await addGeneratedAliasIfMissing(ctx, TABLE, camel, snake);
      if (added) ADDED.push(camel);
    }
  },

  async down(...args) {
    const { qi } = resolveArgs(args);
    // Drop only those we added in this run
    for (const camel of ADDED) {
      try { await qi.removeColumn(TABLE, camel); } catch {}
    }
  },
};
