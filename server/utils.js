const DEFAULT_UPSTREAM_TIMEOUT_MS = 30000;

function normalizeHttpUrl(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required`);
  }
  let parsed;
  try { parsed = new URL(value.trim()); } catch { throw new Error(`${label} is not a valid URL`); }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`${label} must use http or https`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${label} must not contain embedded credentials`);
  }
  return parsed.toString().replace(/\/$/, "");
}

function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_UPSTREAM_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

// AI providers sometimes wrap valid JSON in markdown or explanatory text.
// Keep this tolerant at the boundary, while still requiring an actual array.
function extractJsonArray(text) {
  if (typeof text !== "string") throw new Error("AI response did not contain a valid JSON array");
  const value = text.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
  for (const candidate of [value, value.slice(value.indexOf("["), value.lastIndexOf("]") + 1)]) {
    if (!candidate || !candidate.startsWith("[") || !candidate.endsWith("]")) continue;
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed)) return parsed;
    } catch { /* Try the next extraction strategy. */ }
  }
  const match = value.match(/\[[\s\S]*\]/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed)) return parsed;
    } catch { /* Fall through to the consistent error below. */ }
  }
  throw new Error("AI response did not contain a valid JSON array");
}

module.exports = { DEFAULT_UPSTREAM_TIMEOUT_MS, normalizeHttpUrl, fetchWithTimeout, extractJsonArray };
