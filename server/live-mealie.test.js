const test = require("node:test");
const assert = require("node:assert/strict");
const { app } = require("./index");

const mealieUrl = process.env.MEALIE_TEST_URL;
const token = process.env.MEALIE_TEST_TOKEN;
const live = Boolean(mealieUrl && token);

test("live Mealie recipe create, PATCH, GET, and cleanup contract", { skip: !live }, async () => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = {
    "Content-Type": "application/json",
    "X-Mealie-Url": mealieUrl,
    Authorization: `Bearer ${token}`,
  };
  let slug;
  let cookbookId;
  try {
    const created = await fetch(`${base}/api/recipes`, {
      method: "POST", headers, body: JSON.stringify({ name: "PowerTools API Contract Test" }),
    });
    const createdText = await created.text();
    assert.equal(created.status, 201, createdText);
    slug = JSON.parse(createdText);

    const patch = await fetch(`${base}/api/recipes/${slug}`, {
      method: "PATCH", headers, body: JSON.stringify({
        recipeIngredient: [{
          quantity: 1,
          unit: null,
          food: null,
          note: "contract test",
          display: "contract test",
          substitutions: [],
        }],
      }),
    });
    const patchText = await patch.text();
    assert.equal(patch.status, 200, patchText);
    const patchedRecipe = JSON.parse(patchText);
    assert.equal(patchedRecipe.recipeIngredient[0].note, "contract test");

    const fetched = await fetch(`${base}/api/recipes/${slug}`, { headers });
    assert.equal(fetched.status, 200);
    const recipe = await fetched.json();
    assert.equal(recipe.slug, slug);

    const cookbookPayload = {
      name: "PowerTools API Contract Cookbook",
      description: "Temporary contract test",
      public: false,
      queryFilterString: `id IN ["${recipe.id}"]`,
    };
    const cookbookResponse = await fetch(`${base}/api/households/cookbooks`, {
      method: "POST", headers, body: JSON.stringify(cookbookPayload),
    });
    const cookbookText = await cookbookResponse.text();
    assert.equal(cookbookResponse.status, 201, cookbookText);
    const cookbook = JSON.parse(cookbookText);
    cookbookId = cookbook.id;
    assert.match(cookbook.queryFilterString, /id IN/);

    const updatedCookbook = await fetch(`${base}/api/households/cookbooks/${cookbookId}`, {
      method: "PUT", headers, body: JSON.stringify(cookbookPayload),
    });
    assert.equal(updatedCookbook.status, 200, await updatedCookbook.text());
  } finally {
    if (cookbookId) {
      const removedCookbook = await fetch(`${base}/api/households/cookbooks/${cookbookId}`, { method: "DELETE", headers });
      assert.ok([200, 204].includes(removedCookbook.status), `cookbook cleanup failed: ${removedCookbook.status}`);
    }
    if (slug) {
      const removed = await fetch(`${base}/api/recipes/${slug}`, { method: "DELETE", headers });
      assert.ok([200, 204].includes(removed.status), `cleanup failed: ${removed.status}`);
    }
    await new Promise(resolve => server.close(resolve));
  }
});
