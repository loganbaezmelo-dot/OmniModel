// api/user_sync.js
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;

  if (!kvUrl || !kvToken) {
    return res.status(500).json({ error: "Vercel KV not configured" });
  }

  async function kvCmd(command, ...args) {
    const r = await fetch(`${kvUrl}/${command}/${args.map(encodeURIComponent).join("/")}`, {
      headers: { Authorization: `Bearer ${kvToken}` }
    });
    return (await r.json()).result;
  }

  if (req.method === "POST") {
    let payload = req.body;
    if (typeof payload === "string") {
      try { payload = JSON.parse(payload); } catch(e) { payload = {}; }
    }
    const { userId, apiKey, model, schedules, active } = payload || {};

    if (!userId) return res.status(400).json({ error: "userId is required" });

    await kvCmd("set", `agent:user:${userId}`, JSON.stringify({
      userId,
      apiKey,
      model: model || "gemini-pro-latest",
      schedules: schedules || [],
      active: active ?? true,
      updatedAt: new Date().toISOString()
    }));

    await kvCmd("sadd", "all_agent_users", userId);
    return res.status(200).json({ success: true, userId });
  }

  if (req.method === "GET") {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: "userId required" });

    const raw = await kvCmd("get", `agent:user:${userId}`);
    const data = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : null;
    return res.status(200).json({ user: data });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
