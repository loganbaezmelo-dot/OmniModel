// api/cron.js
export default async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized cron execution" });
  }

  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;

  if (!kvUrl || !kvToken) {
    return res.status(500).json({ error: "Vercel KV credentials missing" });
  }

  async function kvCmd(command, ...args) {
    const r = await fetch(`${kvUrl}/${command}/${args.map(encodeURIComponent).join("/")}`, {
      headers: { Authorization: `Bearer ${kvToken}` }
    });
    const d = await r.json();
    return d.result;
  }

  try {
    const userIds = (await kvCmd("smembers", "all_agent_users")) || [];
    const executionResults = [];
    const now = Date.now();

    for (const userId of userIds) {
      const rawUserData = await kvCmd("get", `agent:user:${userId}`);
      if (!rawUserData) continue;

      const userConfig = typeof rawUserData === "string" ? JSON.parse(rawUserData) : rawUserData;
      const { apiKey, model = "gemini-pro-latest", active = true, schedules = [] } = userConfig;

      if (!active || !apiKey || !schedules.length) continue;

      for (const sc of schedules) {
        if (!sc.enabled) continue;
        const intervalMs = (parseInt(sc.intervalMinutes, 10) || 30) * 60 * 1000;
        const lastRun = sc.lastRun || 0;

        if (now - lastRun >= intervalMs) {
          const cronPrompt = `[AUTOMATED BACKGROUND CRON SCHEDULE: "${sc.id}"]\n${sc.prompt}\nExecute any required web searches, HTTP requests, or tools autonomously to complete the scheduled task.`;

          try {
            const apiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                contents: [{ role: "user", parts: [{ text: cronPrompt }] }]
              })
            });

            const data = await apiRes.json();
            const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "Completed (no content)";

            sc.lastRun = now;
            sc.lastResult = reply.slice(0, 300);
            executionResults.push({ userId, scheduleId: sc.id, status: "Executed" });
          } catch (execErr) {
            executionResults.push({ userId, scheduleId: sc.id, status: `Failed: ${execErr.message}` });
          }
        }
      }

      userConfig.updatedAt = new Date().toISOString();
      await kvCmd("set", `agent:user:${userId}`, JSON.stringify(userConfig));
    }

    return res.status(200).json({ success: true, processed: executionResults });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
