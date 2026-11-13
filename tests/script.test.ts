import { test } from "node:test";
import assert from "node:assert/strict";
import {
  splitStatements,
  usesBindPlaceholders,
} from "../src/security/sql-policy.js";
test("splitStatements splits top-level semicolons and tolerates whitespace/comments", () => {
  assert.deepEqual(splitStatements("SELECT 1; SELECT 2;"), [
    "SELECT 1",
    "SELECT 2",
  ]);
  assert.deepEqual(
    splitStatements("SELECT 1 ;\n\n-- a comment\n SELECT 2;/* trailer */"),
    ["SELECT 1", "-- a comment\n SELECT 2"],
  );
  assert.deepEqual(splitStatements("  ;  ;;  "), []);
});
test("semicolons inside strings, quoted identifiers and comments do not split", () => {
  assert.deepEqual(
    splitStatements(
      "SELECT 'a;b'; SELECT \"quoted_ident\" -- trailing; comment\n; SELECT 2",
    ),
    ["SELECT 'a;b'", 'SELECT "quoted_ident" -- trailing; comment', "SELECT 2"],
  );
  assert.deepEqual(
    splitStatements("/* /* nested; */ still comment; */ SELECT 1"),
    ["/* /* nested; */ still comment; */ SELECT 1"],
  );
});
test("dollar-quoted bodies do not split", () => {
  assert.deepEqual(
    splitStatements(
      "CREATE FUNCTION f() RETURNS integer AS $$ BEGIN RETURN 1; END $$ LANGUAGE plpgsql; SELECT 2;",
    ),
    [
      "CREATE FUNCTION f() RETURNS integer AS $$ BEGIN RETURN 1; END $$ LANGUAGE plpgsql",
      "SELECT 2",
    ],
  );
});
test("PL/SQL definitions with depth-tracked blocks do not split at inner semicolons", () => {
  assert.deepEqual(
    splitStatements(
      "CREATE OR REPLACE PROCEDURE p AS BEGIN IF 1 = 1 THEN NULL; END IF; NULL; END;\nSELECT 1;",
    ),
    [
      "CREATE OR REPLACE PROCEDURE p AS BEGIN IF 1 = 1 THEN NULL; END IF; NULL; END",
      "SELECT 1",
    ],
  );
  assert.deepEqual(
    splitStatements(
      "CREATE OR REPLACE PACKAGE p AS PROCEDURE q(x NUMBER); END p;\nSELECT 1;",
    ),
    ["CREATE OR REPLACE PACKAGE p AS PROCEDURE q(x NUMBER); END p", "SELECT 1"],
  );
  assert.deepEqual(
    splitStatements(
      "CREATE OR REPLACE PACKAGE BODY p AS PROCEDURE q(x NUMBER); BEGIN NULL; END q; END p;\nSELECT 2;",
    ),
    [
      "CREATE OR REPLACE PACKAGE BODY p AS PROCEDURE q(x NUMBER); BEGIN NULL; END q; END p",
      "SELECT 2",
    ],
  );
});
test("routine headers with declaration sections fail closed instead of splitting mid-body", () => {
  // Declaration-section routines (IS v NUMBER;) are not auto-splitable; the
  // fragments are rejected by batch policy checks before execution.
  assert.deepEqual(
    splitStatements(
      "CREATE FUNCTION f RETURN NUMBER IS v NUMBER; BEGIN NULL; END;",
    ),
    ["CREATE FUNCTION f RETURN NUMBER IS v NUMBER", "BEGIN NULL", "END"],
  );
});
test("unterminated constructs throw instead of producing partial statements", () => {
  assert.throws(() => splitStatements("SELECT 'unterminated"));
  assert.throws(() => splitStatements("SELECT 1 /* unterminated"));
  assert.throws(() => splitStatements("SELECT $$ unterminated"));
  assert.throws(() => splitStatements("SELECT 'a\\'; SELECT 2"));
});
test("usesBindPlaceholders detects $n and :name and ignores strings, casts and comments", () => {
  assert.equal(usesBindPlaceholders("SELECT * FROM t WHERE id = $1"), true);
  assert.equal(usesBindPlaceholders("SELECT * FROM dual WHERE id = :id"), true);
  assert.equal(usesBindPlaceholders("SELECT x::text FROM t"), false);
  assert.equal(usesBindPlaceholders("SELECT '$1', ':id'"), false);
  assert.equal(usesBindPlaceholders("SELECT 1 -- :id\n WHERE x = 1"), false);
  assert.equal(usesBindPlaceholders("SELECT 1 /* $1 */ WHERE y = 2"), false);
});
