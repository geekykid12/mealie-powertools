const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { app } = require("./index");

let upstream;
let powerTools;
let mealieUrl;
let powerToolsUrl;
const requests = [];

test.before(async () => {
  upstream = http.createServer((req, res) => {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      const parsedBody = body && req.headers["content-type"]?.includes("application/json")
        ? JSON.parse(body) : body;
      requests.push({ method: req.method, url: req.url, headers: req.headers, body: parsedBody });

      if (req.method === "GET" && req.url.startsWith("/api/recipes?")) {
        const page = new URL(req.url, "http://test").searchParams.get("page");
        const items = page === "2" ? [{ id: "recipe-2", slug: "soup-2", name: "Soup 2" }] : [{ id: "recipe-1", slug: "soup-1", name: "Soup 1" }];
        return json(res, { items, total: 2, total_pages: 2 });
      }
      if (req.method === "PATCH" && req.url === "/api/recipes/soup-1") return json(res, { slug: "soup-1", ...parsedBody });
      if (req.method === "PUT" && req.url === "/api/households/cookbooks/cb-1") return json(res, parsedBody);
      if (req.method === "POST" && req.url === "/api/organizers/tags") return json(res, { id: "tag-1", ...parsedBody });
      res.writeHead(404, { "Content-Type": "application/json" }).end(JSON.stringify({ detail: "not found" }));
    });
  });
  await listen(upstream);
  mealieUrl = `http://127.0.0.1:${upstream.address().port}/api`;

  powerTools = app.listen(0, "127.0.0.1");
  await new Promise(resolve => powerTools.once("listening", resolve));
  powerToolsUrl = `http://127.0.0.1:${powerTools.address().port}`;
});

test.after(async () => {
  await Promise.all([
    new Promise(resolve => powerTools.close(resolve)),
    new Promise(resolve => upstream.close(resolve)),
  ]);
});

function listen(server) {
  return new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
}

function json(res, value) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(value));
}

async function call(path, options = {}) {
  return fetch(`${powerToolsUrl}/api${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Mealie-Url": mealieUrl,
      Authorization: "Bearer test-token",
      ...(options.headers || {}),
    },
  });
}

test("forwards Mealie pagination requests and preserves response envelopes", async () => {
  const response = await call("/recipes?page=1&perPage=100");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.total_pages, 2);
  assert.equal(body.items[0].slug, "soup-1");
  assert.equal(requests.at(-1).headers.authorization, "Bearer test-token");
});

test("forwards recipe PATCH payloads without changing ingredient fields", async () => {
  const payload = {
    recipeIngredient: [{
      quantity: 2,
      unit: { id: "unit-1", name: "cup" },
      food: { id: "food-1", name: "onion" },
      note: "diced",
      substitutions: [{ note: "shallot" }],
    }],
    tags: [{ id: "tag-1", name: "Easy Recipes", slug: "easy-recipes" }],
  };
  const response = await call("/recipes/soup-1", { method: "PATCH", body: JSON.stringify(payload) });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).recipeIngredient, payload.recipeIngredient);
  const request = requests.at(-1);
  assert.equal(request.method, "PATCH");
  assert.deepEqual(request.body, payload);
});

test("forwards selected recipe ids in cookbook updates", async () => {
  const payload = {
    name: "Dinner",
    description: "Weeknight meals",
    public: false,
    queryFilterString: 'id IN ["recipe-1", "recipe-2"]',
  };
  const response = await call("/households/cookbooks/cb-1", { method: "PUT", body: JSON.stringify(payload) });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), payload);
  assert.deepEqual(requests.at(-1).body, payload);
});

test("forwards taxonomy creation to the correct Mealie endpoint", async () => {
  const response = await call("/organizers/tags", {
    method: "POST",
    body: JSON.stringify({ name: "Easy Recipes", slug: "easy-recipes" }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).slug, "easy-recipes");
  assert.equal(requests.at(-1).url, "/api/organizers/tags");
});
