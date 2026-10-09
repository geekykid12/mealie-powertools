const express = require("express");
const httpProxy = require("http-proxy");
const path = require("path");
const { Readable } = require("stream");
const { normalizeHttpUrl, fetchWithTimeout, extractJsonArray } = require("./utils");

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "10mb" }));

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});

const UPSTREAM_TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS || 30000);
// Local LLMs such as Ollama may spend minutes loading a model before replying.
// Ollama may need several minutes to load a model and generate a response.
const AI_UPSTREAM_TIMEOUT_MS = Number(process.env.AI_UPSTREAM_TIMEOUT_MS || 600000);
const MEALIE_ALLOWED_HOSTS = process.env.MEALIE_ALLOWED_HOSTS || "";
const AI_ALLOWED_HOSTS = process.env.AI_ALLOWED_HOSTS || "";

function enforceAllowedHost(url, label, configuredHosts) {
  if (!configuredHosts.trim()) return url;
  const hostname = new URL(url).hostname.toLowerCase();
  const allowed = configuredHosts.split(",").map(value => value.trim().toLowerCase()).filter(Boolean);
  const matches = allowed.some(pattern => pattern === hostname
    || (pattern.startsWith("*.") && hostname.endsWith(pattern.slice(1))));
  if (!matches) throw new Error(`${label} host is not in the configured allowlist`);
  return url;
}

function upstreamHeaders(token) {
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    "Content-Type": "application/json",
  };
}

// ── Proxy cache ────────────────────────────────────────────────────────────────
const proxyCache = new Map();
function getProxy(target) {
  if (!proxyCache.has(target)) {
    const proxy = httpProxy.createProxyServer({ target, changeOrigin: true });
    proxy.on("proxyReq", (proxyReq, req) => {
      // express.json() consumes JSON request streams before the proxy sees
      // them. Re-serialize parsed bodies so POST/PATCH/PUT reaches Mealie.
      if (req.body === undefined) return;
      const body = JSON.stringify(req.body);
      proxyReq.setHeader("content-type", "application/json");
      proxyReq.setHeader("content-length", Buffer.byteLength(body));
      proxyReq.write(body);
    });
    proxy.on("proxyRes", (proxyRes, req) => {
      console.log(`[proxy res] ${proxyRes.statusCode} ${req.method} ${req.url}`);
    });
    proxy.on("error", (err, req, res) => {
      console.error(`[proxy error] ${err.message}`);
      if (!res.headersSent) res.status(502).json({ error: `Proxy error: ${err.message}` });
    });
    proxyCache.set(target, (req, res) => proxy.web(req, res));
  }
  return proxyCache.get(target);
}

// ── Helper ─────────────────────────────────────────────────────────────────────
async function mealieJson(url, token) {
  const safeUrl = normalizeHttpUrl(url, "Mealie URL");
  enforceAllowedHost(safeUrl, "Mealie URL", MEALIE_ALLOWED_HOSTS);
  const r = await fetchWithTimeout(safeUrl, { headers: upstreamHeaders(token) });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  const text = await r.text();
  if (text.trimStart().startsWith("<")) throw new Error(`Route not found: ${url}`);
  return JSON.parse(text);
}

// ── Static frontend ────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, "../dist")));
app.get("/healthz", (req, res) => res.json({ status: "ok" }));

// ── AI provider info ───────────────────────────────────────────────────────────
// Returns whether AI is configured and the default provider's baseUrl + model
// The API key is never exposed by Mealie so the user must supply it separately
app.post("/ai-info", async (req, res) => {
  const { mealieUrl, token } = req.body;
  if (!mealieUrl || !token) return res.status(400).json({ error: "Missing params" });

  try {
    const safeMealieUrl = normalizeHttpUrl(mealieUrl, "Mealie URL");
    enforceAllowedHost(safeMealieUrl, "Mealie URL", MEALIE_ALLOWED_HOSTS);
    // 1. Get settings — tells us aiEnabled + defaultProviderId + groupId indirectly
    const settings = await mealieJson(`${safeMealieUrl}/groups/ai-providers/settings`, token);
    if (!settings.aiEnabled || !settings.defaultProviderId) {
      return res.json({ aiEnabled: false });
    }

    // 2. Get the user's group to find the groupId
    const group = await mealieJson(`${safeMealieUrl}/groups/self`, token);
    const groupId = group.id;

    // 3. Fetch the default provider's config via admin endpoint (no apiKey returned)
    let providerName = "", baseUrl = "", model = "";
    try {
      const provider = await mealieJson(
        `${safeMealieUrl}/admin/groups/${groupId}/ai-providers/providers/${settings.defaultProviderId}`,
        token
      );
      providerName = provider.name || "";
      baseUrl = provider.baseUrl || "";
      model = provider.model || provider.name || "";
    } catch {
      // Admin endpoint failed — use name from settings list as fallback
      const p = (settings.providers || []).find(p => p.id === settings.defaultProviderId);
      providerName = p?.name || "";
      model = p?.name || "";
    }

    res.json({ aiEnabled: true, providerName, baseUrl, model });
  } catch (e) {
    console.error("[ai-info]", e.message);
    res.json({ aiEnabled: false, error: e.message });
  }
});

// ── AI Cookbook endpoint ───────────────────────────────────────────────────────

app.post("/ai-cookbook", async (req, res) => {
  const { recipes, cookbooks, prompt, aiApiKey, aiBaseUrl, aiModel } = req.body;
  if (!aiApiKey) return res.status(400).json({ error: "Missing AI API key" });
  if (!Array.isArray(recipes)) return res.status(400).json({ error: "recipes must be an array" });
  if (cookbooks !== undefined && !Array.isArray(cookbooks)) return res.status(400).json({ error: "cookbooks must be an array" });

  let baseUrl;
  try {
    baseUrl = normalizeHttpUrl(aiBaseUrl || "https://api.openai.com/v1", "AI base URL");
    enforceAllowedHost(baseUrl, "AI base URL", AI_ALLOWED_HOSTS);
  }
  catch (e) { return res.status(400).json({ error: e.message }); }
  const model = aiModel || "gpt-4o-mini";

  try {
    const recipeList = recipes.map(r => {
      const cats = (r.recipeCategory || []).map(c => c.name).join(", ");
      const tags  = (r.tags || []).map(t => t.name).join(", ");
      return `- ${r.name}${cats ? ` [${cats}]` : ""}${tags ? ` #${tags}` : ""}`;
    }).join("\n");
    const existingCbs = (cookbooks || []).map(c => c.name).join(", ");

    const systemPrompt = `You are a personal recipe collection organizer. Your job is to group a user's actual saved recipes into meaningful CATEGORY-based collections (like "Quick Weeknight Dinners", "Soups & Stews", "Meal Prep", "Vegetarian", "Party Food", etc.). IMPORTANT RULES:
- Do NOT suggest real published cookbook titles (not "Jerusalem: A Cookbook", not "The Food Lab", etc.)
- Do NOT invent recipe names — only use recipes from the user's list
- Suggest 3-5 practical, themed categories that would actually help organize THEIR specific collection
- Each category name should be short and descriptive (2-5 words)
- You MUST respond with ONLY a valid JSON array. No explanation, no preamble, no markdown, no code fences. Start with [ and end with ].`;

    const userPrompt = `Here are my ${recipes.length} saved recipes:
${recipeList}
${existingCbs ? "\nI already have these collections (avoid duplicating): " + existingCbs + "\n" : ""}
${prompt ? "Special request: " + prompt + "\n" : ""}
Group these into 3-5 themed collections using ONLY the recipe names above. Return a JSON array where each item is: {"name":"Short Category Name","description":"One sentence about what unifies these recipes","recipeNames":["Exact Recipe Name From My List Above"]}

Remember: use only recipe names from my list above, and name the collections as practical categories, NOT published book titles.`;

    const body = {
      model,
      max_tokens: 2000,
      temperature: 0.3,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userPrompt   },
      ],
    };

    // Gemini supports response_format to force JSON output
    const isGemini = baseUrl.includes("googleapis.com") || baseUrl.includes("generativelanguage");
    if (isGemini) body.response_format = { type: "json_object" };

    console.log("[ai-cookbook] calling", baseUrl, "model:", model);
    const aiRes = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${aiApiKey}` },
      body: JSON.stringify(body),
    }, AI_UPSTREAM_TIMEOUT_MS);

    if (!aiRes.ok) {
      const err = await aiRes.text();
      throw new Error(`AI API ${aiRes.status}: ${err.slice(0, 300)}`);
    }

    const aiData  = await aiRes.json();
    const rawText = aiData.choices?.[0]?.message?.content || "";
    const suggestions = extractJsonArray(rawText);
    res.json({ suggestions, model });
  } catch (e) {
    console.error("[ai-cookbook]", e.message);
    res.status(500).json({ error: e.message });
  }
});
// ── AI Taxonomy endpoint ───────────────────────────────────────────────────────
app.post("/ai-taxonomy", async (req, res) => {
  const { recipes, existingItems, type, prompt, aiApiKey, aiBaseUrl, aiModel } = req.body;
  if (!aiApiKey) return res.status(400).json({ error: "Missing AI API key" });
  if (!Array.isArray(recipes)) return res.status(400).json({ error: "recipes must be an array" });
  if (existingItems !== undefined && !Array.isArray(existingItems)) return res.status(400).json({ error: "existingItems must be an array" });
  if (!['tags', 'categories'].includes(type)) return res.status(400).json({ error: "type must be tags or categories" });

  let baseUrl;
  try {
    baseUrl = normalizeHttpUrl(aiBaseUrl || "https://api.openai.com/v1", "AI base URL");
    enforceAllowedHost(baseUrl, "AI base URL", AI_ALLOWED_HOSTS);
  }
  catch (e) { return res.status(400).json({ error: e.message }); }
  const model = aiModel || "gpt-4o-mini";

  const isCategory = type === "categories";
  const typeSingular = isCategory ? "category" : "tag";
  const typePlural = isCategory ? "categories" : "tags";

  const examples = isCategory
    ? "Breakfast, Lunch, Dinner, Appetizer, Soup, Salad, Dessert, Snack, Side Dish, Drinks, Baking, Vegetarian, Vegan, Gluten-Free"
    : "Quick, Easy, Healthy, Spicy, Comfort Food, Meal Prep, Kid-Friendly, Date Night, Holiday, Summer, Winter";

  try {
    const recipeList = recipes.map(r => `- ${r.name}`).join("\n");
    const existing = (existingItems || []).map(i => i.name).join(", ");

    const systemPrompt = `You are a recipe collection organizer. Your job is to suggest useful ${typePlural} to help organize a recipe collection. RULES:
- Suggest practical, short ${typePlural} (1-4 words each) that genuinely describe the recipes
- Do NOT suggest ${typePlural} that already exist
- Focus on ${isCategory ? "meal types, cuisine styles, and dietary categories" : "recipe characteristics and attributes"}
- Examples of good ${typePlural}: ${examples}
- You MUST respond with ONLY a valid JSON array. No explanation, no markdown. Start with [ and end with ].`;

    const userPrompt = `Here are my ${recipes.length} recipes:
${recipeList}
 ${existing ? `\nAlready have these ${typePlural} (do NOT suggest these): ${existing}\n` : ""}
${prompt ? "User request: " + prompt + "\n" : ""}
Suggest 5-10 useful ${typePlural} for this collection. Return a JSON array where each item is:
{"name":"Category Name","description":"One sentence about which recipes this applies to","matchingRecipes":["Recipe Name 1","Recipe Name 2"]}

Only include recipe names that actually exist in my list above.`;

    const body = {
      model,
      max_tokens: 2000,
      temperature: 0.3,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userPrompt   },
      ],
    };

    const isGemini = baseUrl.includes("googleapis.com") || baseUrl.includes("generativelanguage");
    if (isGemini) body.response_format = { type: "json_object" };

    console.log("[ai-taxonomy] calling", baseUrl, "model:", model, "type:", type);
    let aiRes;
    try {
      aiRes = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${aiApiKey}` },
      body: JSON.stringify(body),
      }, AI_UPSTREAM_TIMEOUT_MS);

    } catch (fetchErr) {
      throw new Error(`fetch failed to reach ${baseUrl} — check network connectivity from the container: ${fetchErr.message}`);
    }

    if (!aiRes.ok) {
      const err = await aiRes.text();
      throw new Error(`AI API ${aiRes.status}: ${err.slice(0, 300)}`);
    }

    const aiData  = await aiRes.json();
    const rawText = aiData.choices?.[0]?.message?.content || "";
    const suggestions = extractJsonArray(rawText);
    res.json({ suggestions, model });
  } catch (e) {
    console.error("[ai-taxonomy]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Image proxy ────────────────────────────────────────────────────────────────
app.get("/img", async (req, res) => {
  const { src, mealie, token } = req.query;
  if (!src || !mealie) return res.status(400).send("Missing src or mealie param");
  try {
    if (/^[a-z][a-z\d+.-]*:/i.test(src) || src.startsWith("//")) {
      return res.status(400).send("Image source must be a relative Mealie path");
    }
    const baseUrl = normalizeHttpUrl(decodeURIComponent(mealie), "Mealie URL");
    enforceAllowedHost(baseUrl, "Mealie URL", MEALIE_ALLOWED_HOSTS);
    const url = new URL(src.replace(/^\//, ""), `${baseUrl}/`).toString();
    const imgRes = await fetchWithTimeout(url, {
      headers: token ? { Authorization: `Bearer ${decodeURIComponent(token)}` } : {},
    });
    if (!imgRes.ok) return res.status(imgRes.status).send("Image fetch failed");
    res.set("Content-Type", imgRes.headers.get("content-type") || "image/webp");
    res.set("Cache-Control", "public, max-age=3600");
    // Native fetch returns a Web ReadableStream, not a Node stream.
    if (imgRes.body && typeof Readable.fromWeb === "function") {
      Readable.fromWeb(imgRes.body).pipe(res);
    } else {
      res.end(Buffer.from(await imgRes.arrayBuffer()));
    }
  } catch (e) {
    console.error("[img proxy]", e.message);
    res.status(502).send("Image proxy error");
  }
});

// ── Mealie API proxy ───────────────────────────────────────────────────────────
app.use("/api", (req, res, next) => {
  const mealieUrl = req.headers["x-mealie-url"];
  if (!mealieUrl) return res.status(400).json({ error: "Missing X-Mealie-Url header" });
  let safeMealieUrl;
  try { safeMealieUrl = normalizeHttpUrl(mealieUrl, "Mealie URL"); }
  catch (e) { return res.status(400).json({ error: e.message }); }
  try { enforceAllowedHost(safeMealieUrl, "Mealie URL", MEALIE_ALLOWED_HOSTS); }
  catch (e) { return res.status(403).json({ error: e.message }); }
  console.log(`[proxy] ${req.method} ${new URL(safeMealieUrl).host}${req.url}`);
  getProxy(safeMealieUrl)(req, res, next);
});

// ── SPA fallback ───────────────────────────────────────────────────────────────
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../dist/index.html"));
});

if (require.main === module) {
  app.listen(3000, "0.0.0.0", () => {
    console.log("Mealie PowerTools running on http://0.0.0.0:3000");
  });
}

module.exports = { app };
