import { test} from "node:test";
import assert from "node:assert/strict";
import {greet} from "../src/greet.ts";

test("greet says hello", () => {
  assert.equal(greet("wyrm"), "Hello, wyrm!");
});