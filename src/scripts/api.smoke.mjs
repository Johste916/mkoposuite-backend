import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";

const { default: app } = await import("../app.js");

const API_PREFIX = process.env.API_PREFIX || "/api";
const TENANT = process.env.DEFAULT_TENANT_ID || "00000000-0000-0000-0000-000000000000";
const DEFAULT_QS = "?from=2000-01-01&to=2100-01-01";

function withTenant(req) {
  return req
    .set("x-tenant-id", TENANT)
    .set("accept", "application/json");
}

async function expectOneOf(paths, expected = 200, opts = {}) {
  const combos = [];
  for (const p of paths) {
    const full = p.startsWith("/") ? p : `/${p}`;
    combos.push(full, API_PREFIX + full);
  }
  const tried = [];
  for (const p of combos) {
    try {
      let req = request(app).get(p + (opts.qs || ""));
      if (opts.csv) req = req.set("accept", "text/csv");
      req = withTenant(req);
      const res = await req.expect(expected);
      return res;
    } catch (e) {
      tried.push(`${p} → ${e.status || e.code || e.message}`);
    }
  }
  throw new Error(`None of the candidate paths responded with ${expected}:\n${tried.join("\n")}`);
}

test("Health endpoint is healthy", async () => {
  const res = await expectOneOf(["/api/health", "/health", "/_selfcheck"], 200);
  assert.ok(res.body || res.text);
});

// ── Business endpoints ──────────────────────────────────────────────────────

test("Loans summary responds", async () => {
  await expectOneOf(["/loans/summary"], 200, { qs: DEFAULT_QS });
});

test("Borrowers loan-summary responds", async () => {
  await expectOneOf(["/borrowers/loan-summary"], 200, { qs: DEFAULT_QS });
});

test("Profit & Trial balance CSV endpoints respond", async () => {
  await expectOneOf(["/profit-loss.csv"], 200, { qs: DEFAULT_QS, csv: true });
  await expectOneOf(["/trial-balance.csv"], 200, { qs: DEFAULT_QS, csv: true });
});

test("Repayments reports summary/timeseries respond", async () => {
  await expectOneOf(["/reports/summary"], 200, { qs: DEFAULT_QS });
  await expectOneOf(["/reports/timeseries"], 200, { qs: DEFAULT_QS });
});
