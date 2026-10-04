import { test } from "node:test";
import assert from "node:assert/strict";
import { isKeyword, KEYWORDS } from "../src/token.ts";

test("every keyword is recognised", () => {
  for (const word of KEYWORDS) {
    assert.equal(isKeyword(word), true);
  }
});

test("identifiers are not keywords", () => {
  assert.equal(isKeyword("dragon"), false);
  assert.equal(isKeyword("Let"), false);
  assert.equal(isKeyword(""), false);
});