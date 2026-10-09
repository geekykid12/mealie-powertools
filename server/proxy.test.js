const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { app } = require("./index");

function listen(server) {
  return new Promise(resolve => {
    const listener = server.listen(0, "127.0.0.1", () => resolve(listener));
  });
}

function close(server) {
  return new Promise(resolve => server.close(resolve));
}

test("forwards JSON request bodies through the Mealie proxy", async () => {
  let received;
  const upstream = http.createServer((req, res) => {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      received = { method: req.method, url: req.url, body: JSON.parse(body) };
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true }));
    });
  });
  const upstreamListener = await listen(upstream);
  const frontendListener = await listen(app);

  try {
    const response = await fetch(`http://127.0.0.1:${frontendListener.address().port}/api/recipes/test`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-Mealie-Url": `http://127.0.0.1:${upstreamListener.address().port}`,
      },
      body: JSON.stringify({ recipeIngredient: [{ food: { id: "food-1" } }] }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(received, {
      method: "PATCH",
      url: "/recipes/test",
      body: { recipeIngredient: [{ food: { id: "food-1" } }] },
    });
  } finally {
    await close(frontendListener);
    await close(upstream);
  }
});
