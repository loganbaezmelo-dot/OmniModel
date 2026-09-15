// api/proxy.js
export default async function handler(req, res) {
  // 1. CORS headers so OmniModel frontend can talk to it
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // 2. Safe payload parsing (handles query params, parsed JSON, or raw body strings)
  let payload = req.body;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch (e) {
      payload = {};
    }
  }
  payload = payload || req.query || {};

  const { targetUrl, method = "GET", headers = {}, body = null } = payload;

  if (!targetUrl) {
    return res.status(400).json({ error: "targetUrl is required" });
  }

  try {
    const fetchOpts = {
      method: method.toUpperCase(),
      headers: {
        "User-Agent": "OmniModelAgent/1.0",
        ...headers
      }
    };

    if (body && method.toUpperCase() !== "GET") {
      fetchOpts.body = typeof body === "string" ? body : JSON.stringify(body);
      if (!fetchOpts.headers["Content-Type"]) {
        fetchOpts.headers["Content-Type"] = "application/json";
      }
    }

    const externalRes = await fetch(targetUrl, fetchOpts);
    const contentType = externalRes.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      const jsonData = await externalRes.json();
      return res.status(externalRes.status).json(jsonData);
    } else {
      const textData = await externalRes.text();
      return res.status(externalRes.status).send(textData);
    }
  } catch (err) {
    return res.status(502).json({ error: `Backend fetch failed: ${err.message}` });
  }
}
