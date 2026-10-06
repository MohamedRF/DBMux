import { test } from "node:test";
import assert from "node:assert/strict";
import { assertPolicy, classify } from "../src/security/sql-policy.js";
import { permissions } from "../src/security/permissions.js";
test("Oracle stored definitions require confirmation, while executable and concatenated blocks are denied", () => {
  const oracle = {
    allowedSchemas: ["APP"],
    protectedSchemas: [],
    requireWhereForUpdate: true,
    requireWhereForDelete: true,
    disabledTools: [],
    blockedTables: [],
    blockedColumns: [],
    engine: "oracle" as const,
  };
  for (const sql of [
    "CREATE OR REPLACE PROCEDURE APP.P AS BEGIN NULL; END;",
    "CREATE OR REPLACE PACKAGE APP.P AS PROCEDURE TEST; END P;",
    "CREATE OR REPLACE PACKAGE BODY APP.P AS PROCEDURE TEST AS BEGIN NULL; END; END P;",
  ]) {
    const c = assertPolicy(sql, permissions("full-development"), oracle);
    assert.equal(c.category, "DDL_CREATE");
    assert.equal(c.requiresConfirmation, true);
  }
  assert.throws(() =>
    assertPolicy("BEGIN NULL; END;", permissions("full-development"), oracle),
  );
  assert.throws(() =>
    assertPolicy(
      "CREATE PROCEDURE APP.P AS BEGIN NULL; END; DROP TABLE APP.T;",
      permissions("full-development"),
      oracle,
    ),
  );
  assert.throws(() =>
    assertPolicy(
      "CREATE PROCEDURE APP.P AS BEGIN NULL; END; CREATE PROCEDURE APP.Q AS BEGIN NULL; END;",
      permissions("full-development"),
      oracle,
    ),
  );
});
const policy = {
  allowedSchemas: ["APP"],
  protectedSchemas: [],
  requireWhereForUpdate: true,
  requireWhereForDelete: true,
  disabledTools: [],
  blockedTables: [],
  blockedColumns: [],
};
test("wildcards, indirect functions, out-of-scope targets and disabled DDL cannot bypass policy", () => {
  for (const sql of [
    "SELECT * FROM APP.T",
    "SELECT APP.COUNT(ID) FROM APP.T",
    "SELECT ID FROM OTHER.T",
    "INSERT ALL INTO APP.T VALUES(1) SELECT 1 FROM DUAL",
    "INSERT INTO APP.T VALUES(1) RETURNING ID",
  ])
    assert.throws(() =>
      assertPolicy(sql, permissions("full-development"), {
        ...policy,
        blockedColumns: ["SECRET"],
      }),
    );
  assert.throws(() =>
    assertPolicy("DROP TABLE APP.T", permissions("full-development"), {
      ...policy,
      disabledTools: ["db_drop_table"],
    }),
  );
});
test("read-only and development permissions intersect with conservative SQL policy", () => {
  for (const sql of ["INSERT INTO APP.T VALUES(1)", "DROP TABLE APP.T"])
    assert.throws(() => assertPolicy(sql, permissions("read-only"), policy));
  assert.throws(() =>
    assertPolicy("DROP TABLE APP.T", permissions("development-write"), policy),
  );
  for (const sql of [
    "DELETE FROM APP.T",
    "UPDATE APP.T SET X=1",
    "UPDATE APP.T SET X=(SELECT 1 FROM APP.U WHERE ID=1)",
    "ALTER TABLE SYS.T ADD X NUMBER",
    "CREATE USER X",
    "BEGIN NULL; END;",
    "SELECT 1; DELETE FROM APP.T",
    "WITH d AS (DELETE FROM APP.T RETURNING *) SELECT * FROM d",
  ])
    assert.throws(
      () => assertPolicy(sql, permissions("full-development"), policy),
      sql,
    );
  assert.equal(
    assertPolicy(
      "/*SELECT*/ INSERT INTO APP.T VALUES(:x)",
      permissions("development-write"),
      policy,
    ).category,
    "INSERT",
  );
  assert.equal(
    classify("WITH x AS (SELECT ';DELETE' AS x) SELECT * FROM x").category,
    "READ",
  );
  assert.equal(classify("DROP TABLE APP.T").risk, "CRITICAL");
  assert.equal(
    assertPolicy(
      "DELETE FROM APP.T WHERE ID=:id",
      permissions("development-write"),
      policy,
    ).requiresConfirmation,
    true,
  );
});
