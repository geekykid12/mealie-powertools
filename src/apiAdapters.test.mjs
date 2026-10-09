import test from "node:test";
import assert from "node:assert/strict";
import {
  cookbookPayload,
  ingredientForSave,
  normalizeRecipePage,
  normalizeAiSuggestions,
  taxonomyForSave,
} from "./apiAdapters.mjs";

test("normalizes Mealie pagination and snake_case recipe fields", () => {
  const page = normalizeRecipePage({ total_count: 1, total_pages: 1, items: [{
    date_added: "2026-01-01", recipe_category: [{ name: "Dinner" }],
  }] });
  assert.equal(page.total, 1);
  assert.equal(page.totalPages, 1);
  assert.equal(page.items[0].dateAdded, "2026-01-01");
  assert.deepEqual(page.items[0].recipeCategory, [{ name: "Dinner" }]);
});

test("builds Mealie-safe ingredient and taxonomy payloads", () => {
  assert.deepEqual(ingredientForSave({ quantity: 1, food: { name: " onion " }, unit: { id: "u1", name: "cup" }, substitutions: [{ note: "shallot" }] }), {
    quantity: 1,
    food: { name: "onion" },
    unit: { id: "u1", name: "cup" },
    substitutions: [{ note: "shallot" }],
  });
  assert.deepEqual(taxonomyForSave({ id: "tag1", name: "Easy Recipes" }), { id: "tag1", name: "Easy Recipes", slug: "easy-recipes" });
});

test("builds cookbook filters from the selected recipe ids", () => {
  assert.deepEqual(cookbookPayload({ name: "Dinner", recipeIds: ["r1", "r2"] }), {
    name: "Dinner", description: "", public: false, queryFilterString: 'id IN ["r1", "r2"]',
  });
  assert.match(cookbookPayload({ name: "Empty", recipeIds: [] }).queryFilterString, /00000000-0000-0000-0000-000000000000/);
});

test("flattens nested AI suggestion responses", () => {
  assert.deepEqual(normalizeAiSuggestions([[{ name: "Quick Meals" }]]), [{ name: "Quick Meals" }]);
});
