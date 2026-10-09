const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeHttpUrl, extractJsonArray } = require("./utils");

test("normalizes valid HTTP URLs without a trailing slash", () => {
  assert.equal(normalizeHttpUrl(" http://mealie:9000/api/ ", "Mealie URL"), "http://mealie:9000/api");
});

test("accepts HTTPS URLs", () => {
  assert.equal(normalizeHttpUrl("https://example.test", "Target"), "https://example.test");
});

test("rejects invalid and unsupported URLs", () => {
  assert.throws(() => normalizeHttpUrl("", "Target"), /Target is required/);
  assert.throws(() => normalizeHttpUrl("not a URL", "Target"), /Target is not a valid URL/);
  assert.throws(() => normalizeHttpUrl("file:///tmp/secret", "Target"), /must use http or https/);
});

test("rejects embedded credentials", () => {
  assert.throws(() => normalizeHttpUrl("https://user:password@example.test", "Target"), /embedded credentials/);
});

test("extracts an array from plain JSON and fenced AI output", () => {
  assert.deepEqual(extractJsonArray('[{"name":"Dinner"}]'), [{ name: "Dinner" }]);
  assert.deepEqual(extractJsonArray("Here are the results:\n```json\n[1, 2]\n```"), [1, 2]);
});

test("rejects AI output without a JSON array", () => {
  assert.throws(() => extractJsonArray("No suggestions"), /valid JSON array/);
  assert.throws(() => extractJsonArray({}), /valid JSON array/);
});
