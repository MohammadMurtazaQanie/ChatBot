import assert from "node:assert/strict";
import test from "node:test";

import { normalizeSourcesList } from "../markdown.js";

test("source bullets are converted to a numbered reference list", () => {
  const response = [
    "Youth participation should be meaningful.[1]",
    "",
    "**Sources:**",
    "- [First publication](https://example.org/first)",
    "  • Second publication",
    "* Third publication",
  ].join("\n");

  assert.equal(
    normalizeSourcesList(response),
    [
      "Youth participation should be meaningful.[1]",
      "",
      "**Sources:**",
      "1. [First publication](https://example.org/first)",
      "2. Second publication",
      "3. Third publication",
    ].join("\n"),
  );
});

test("existing citation numbers are preserved in the reference list", () => {
  const response = [
    "A supported claim.[3]",
    "",
    "**Sources:** 3. Third publication",
    "5) Fifth publication",
  ].join("\n");

  assert.equal(
    normalizeSourcesList(response),
    [
      "A supported claim.[3]",
      "",
      "**Sources:**",
      "3. Third publication",
      "5. Fifth publication",
    ].join("\n"),
  );
});
