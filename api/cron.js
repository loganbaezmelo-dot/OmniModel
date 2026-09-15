// api/cron.js
export default async function handler(req, res) {
  // Verify Vercel Cron secret if running in production
  const authHeader = req.headers.authorization;
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized cron execution" });
  }

  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;

  if (!kvUrl || !kvToken) {
    return res.status(500).json({ error: "Vercel KV credentials not configured." });
  }

  // Helper for Upstash / Vercel KV REST API
  async function kvCmd(command, ...args) {
    const r = await fetch(`${kvUrl}/${command}/${args.map(encodeURIComponent).join("/")}`, {
      headers: { Authorization: `Bearer ${kvToken}` }
    });
    const d = await r.json();
    return d.result;
  }

  try {
    // 1. Get all registered user IDs
    const userIds = (await kvCmd("smembers", "all_agent_users")) || [];
    const executionResults = [];

    for (const userId of userIds) {
      const rawUserData = await kvCmd("get", `agent:user:${userId}`);
      if (!rawUserData) continue;

      const userConfig = typeof rawUserData === "string" ? JSON.parse(rawUserData) : rawUserData;
      const { aibookKey, apiKey, model = "gemini-pro-latest", active = true, schedulePrompt } = userConfig;

      if (!active || !aibookKey) continue;

      // 2. Perform autonomous heartbeat routine for this user
      const routinePrompt = schedulePrompt || "Fetch Aibook feed, check status, solve challenge if needed, and report heartbeat.";

      // Step A: Request synthetic challenge
      const chalRes = await fetch("https://aibook-silk.vercel.app/api/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentKey: aibookKey })
      });
      
      let postResult = "No action needed";

      if (chalRes.ok) {
        const chalData = await chalRes.json();
        const { challengeToken, instruction } = chalData;

        // Step B: Calculate solution if arithmetic puzzle present
        if (instruction && challengeToken) {
          const match = instruction.match(/'([^']+)'/);
          const word = match ? match[1] : "";
          const nonceMatch = instruction.match(/by\s+(\d+)/);
          const nonce = nonceMatch ? parseInt(nonceMatch[1], 10) : 1;

          let asciiSum = 0;
          for (let i = 0; i < word.length; i++) {
            asciiSum += word.charCodeAt(i);
          }
          const solution = asciiSum * nonce;

          // Step C: Autonomous broadcast heartbeat
          const broadcastRes = await fetch("https://aibook-silk.vercel.app/api/broadcast", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${aibookKey}`
            },
            body: JSON.stringify({
              challengeToken,
              solution,
              content: "system routine heartbeat: running autonomous check via Vercel KV cron ⏰🤖"
            })
          });

          if (broadcastRes.ok) {
            postResult = "Heartbeat broadcasted successfully";
          } else {
            postResult = `Broadcast failed: ${broadcastRes.status}`;
          }
        }
      }

      // Step D: Log run to user's history in KV
      userConfig.lastCronRun = new Date().toISOString();
      userConfig.lastResult = postResult;
      await kvCmd("set", `agent:user:${userId}`, JSON.stringify(userConfig));

      executionResults.push({ userId, postResult });
    }

    return res.status(200).json({ success: true, processed: executionResults });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
