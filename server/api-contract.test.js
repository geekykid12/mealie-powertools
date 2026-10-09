const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { app } = require("./index");

let appServer;
let aiServer;
let appBase;
let aiBase;

test.before(async () => {
  aiServer = http.createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/chat/completions") {
      res.writeHead(404).end();
      return;
    }
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      const request = JSON.parse(body);
      const isTaxonomy = request.messages?.[1]?.content?.includes("matchingRecipes");
      const content = isTaxonomy
        ? "```json\n[{\"name\":\"Quick\",\"description\":\"Fast meals\",\"matchingRecipes\":[\"Soup\"]}]\n```"
        : "Here are the results:\n[[{\"name\":\"Quick Meals\",\"description\":\"Fast meals\",\"recipeNames\":[\"Soup\"]}]]";
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content } }] }));
    });
  });
  await new Promise(resolve => aiServer.listen(0, "127.0.0.1", resolve));
  aiBase = `http://127.0.0.1:${aiServer.address().port}`;

  appServer = app.listen(0, "127.0.0.1");
  await new Promise(resolve => appServer.once("listening", resolve));
  appBase = `http://127.0.0.1:${appServer.address().port}`;
});

test.after(async () => {
  await Promise.all([
    new Promise(resolve => appServer.close(resolve)),
    new Promise(resolve => aiServer.close(resolve)),
  ]);
});

test("AI cookbook route accepts provider output and returns normalized suggestions", async () => {
  const response = await fetch(`${appBase}/ai-cookbook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipes: [{ name: "Soup", recipeCategory: [], tags: [] }],
      cookbooks: [],
      aiApiKey: "test-key",
      aiBaseUrl: aiBase,
      aiModel: "test-model",
    }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.model, "test-model");
  assert.equal(body.suggestions[0][0].name, "Quick Meals");
});

test("AI taxonomy route accepts fenced provider output", async () => {
  const response = await fetch(`${appBase}/ai-taxonomy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipes: [{ name: "Soup" }],
      existingItems: [],
      type: "tags",
      aiApiKey: "test-key",
      aiBaseUrl: aiBase,
    }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.suggestions[0].name, "Quick");
});

test("AI routes reject malformed request contracts before contacting a provider", async () => {
  const response = await fetch(`${appBase}/ai-taxonomy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipes: {}, type: "invalid", aiApiKey: "test-key" }),
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /recipes must be an array/);
});
