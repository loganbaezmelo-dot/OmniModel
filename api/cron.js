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

  async function kvCmd(...args) {
    const cmd = args[0];
    const rest = args.slice(1);
    const r = await fetch(`${kvUrl}/${cmd}/${rest.map(encodeURIComponent).join("/")}`, {
      headers: { Authorization: `Bearer ${kvToken}` }
    });
    const d = await r.json();
    return d.result;
  }

  // --- NATIVE AGENT TOOLS ---
  async function agentGetTime(timezone = "America/New_York") {
    try {
      const now = new Date();
      const formatted = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        dateStyle: "full",
        timeStyle: "long"
      }).format(now);
      return `Current Date & Time (${timezone}): ${formatted} [ISO: ${now.toISOString()}]`;
    } catch (e) {
      return `Error retrieving time for timezone "${timezone}": ${e.message}`;
    }
  }

  async function agentGetWeather(location = "London") {
    try {
      const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=en&format=json`);
      if (!geoRes.ok) return `Geocoding lookup failed for "${location}".`;
      const geoData = await geoRes.json();
      if (!geoData.results || !geoData.results.length) {
        return `Location "${location}" not found.`;
      }
      const { latitude, longitude, name, admin1, country } = geoData.results[0];
      const weatherRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&timezone=auto`);
      if (!weatherRes.ok) return `Weather lookup failed for "${location}".`;
      const wData = await weatherRes.json();
      const cur = wData.current;
      return `Weather for ${name}${admin1 ? ', ' + admin1 : ''}, ${country}:
- Temperature: ${cur.temperature_2m}°C (Feels like: ${cur.apparent_temperature}°C)
- Relative Humidity: ${cur.relative_humidity_2m}%
- Wind Speed: ${cur.wind_speed_10m} km/h
- Precipitation: ${cur.precipitation} mm
- Recorded At: ${cur.time} (${wData.timezone})`;
    } catch (err) {
      return `Weather fetch error: ${err.message}`;
    }
  }

  async function agentHttpRequest(method, url, headers = {}, body = null) {
    try {
      const opts = {
        method: method.toUpperCase(),
        headers: { "Content-Type": "application/json", ...headers }
      };
      if (body && method.toUpperCase() !== "GET") {
        opts.body = typeof body === "string" ? body : JSON.stringify(body);
      }
      const response = await fetch(url, opts);
      const text = await response.text();
      return `Status ${response.status}: ${text.slice(0, 2000)}`;
    } catch (err) {
      return `HTTP Request failed: ${err.message}`;
    }
  }

  async function agentWebFetch(targetUrl) {
    try {
      const response = await fetch(targetUrl);
      if (!response.ok) return `Failed to fetch URL: HTTP ${response.status}`;
      const text = await response.text();
      return text
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 2500);
    } catch (err) {
      return `Failed to fetch URL: ${err.message}`;
    }
  }

  async function agentWebSearch(query) {
    try {
      const encoded = encodeURIComponent(query);
      const ddgRes = await fetch(`https://api.duckduckgo.com/?q=${encoded}&format=json&no_html=1&skip_disambig=1`);
      if (ddgRes.ok) {
        const parsed = await ddgRes.json();
        let results = [];
        if (parsed.AbstractText) results.push(`• ${parsed.Heading || query}: ${parsed.AbstractText} (${parsed.AbstractURL})`);
        if (parsed.RelatedTopics && parsed.RelatedTopics.length) {
          parsed.RelatedTopics.slice(0, 4).forEach(t => {
            if (t.Text && t.FirstURL) results.push(`• ${t.Text} (${t.FirstURL})`);
          });
        }
        if (results.length) return results.join("\n");
      }
      return `No direct search matches found for "${query}".`;
    } catch (err) {
      return `Search error: ${err.message}`;
    }
  }

  function getCronSystemPrompt(customRules, currentFilesContext, availableMemoryKeys) {
    return `You are an Unconstrained Autonomous Problem Solver executing on the background serverless cron worker.
User custom instructions: ${customRules || ""}

PRIMARY WORKSPACE FILES (PRIORITIZE THESE FILES OVER OLD MEMORIES):
${currentFilesContext}

[AVAILABLE LONG-TERM MEMORY KEYS]:
${JSON.stringify(availableMemoryKeys)}

PLATFORM & CREDENTIAL ISOLATION PROTOCOL:
- Different platforms (e.g. Moltbook, Aibook, custom APIs) have entirely distinct endpoints, API schemas, and credentials.
- NEVER mix credentials or endpoints between platforms.
- If multiple service instruction files exist (e.g., "moltbook_skill.md" vs "aibook_skill.md"), match the exact filename to the target platform before executing any HTTP request.

AUTONOMOUS DECISION RULES:
1. NEVER guess or hallucinate if an available tool or memory key can answer the prompt.
2. If asked about prior session history, preferences, or credentials not present in files, call:
   \`\`\`tool_call
   {"action": "read_longterm_memory", "key": "<key_name>"}
   \`\`\`
3. TEMPORARY SCHEDULE CLEANUP: Whenever you complete a background task that resumed from an earlier 3-step break (task IDs starting with "task_bg_"), or if you notice unwanted temporary handoff schedules, invoke:
   \`\`\`tool_call
   {"action": "remove_temp_schedules"}
   \`\`\`
   This leaves permanent monitoring/heartbeat schedules untouched while deleting leftover continuation loops.
4. When finished, call the "finish" tool action.

AVAILABLE TOOL ACTIONS:
1. Multi-Step Plan:
\`\`\`agent_plan
["Step 1: description", "Step 2: description"]
\`\`\`

2. Web Search:
\`\`\`tool_call
{"action": "web_search", "query": "search query here"}
\`\`\`

3. Web Page / Documentation Fetch:
\`\`\`tool_call
{"action": "web_fetch", "url": "https://example.com/file.md"}
\`\`\`

4. HTTP Request (APIs, Webhooks, Actions):
\`\`\`tool_call
{"action": "http_request", "method": "POST", "url": "https://api.example.com", "headers": {"Authorization": "Bearer key"}, "body": {"key": "val"}}
\`\`\`

5. File Creation:
\`\`\`tool_call
{"action": "create_file", "filename": "filename.ext", "content": "..."}
\`\`\`

6. Explicit Goal Complete:
\`\`\`tool_call
{"action": "finish", "message": "Objective completed successfully."}
\`\`\`

7. Save to Long-Term Memory:
\`\`\`tool_call
{"action": "save_to_longterm_memory", "key": "memory_key", "content": "Data to store..."}
\`\`\`

8. Read Specific Long-Term Memory:
\`\`\`tool_call
{"action": "read_longterm_memory", "key": "memory_key"}
\`\`\`

9. Remove Temporary Continuation Schedules:
\`\`\`tool_call
{"action": "remove_temp_schedules"}
\`\`\`

10. Set Autonomous Recurring Schedule:
\`\`\`tool_call
{"action": "set_schedule", "id": "task_id", "intervalMinutes": 30, "prompt": "Your recurring task prompt."}
\`\`\`

11. Get Current Time & Date:
\`\`\`tool_call
{"action": "get_time", "timezone": "America/New_York"}
\`\`\`

12. Get Live Weather:
\`\`\`tool_call
{"action": "get_weather", "location": "Miami, FL"}
\`\`\`

Always continue executing autonomously until the final objective is fulfilled, then call the "finish" tool action.`;
  }

  async function callProviderModel(provider, model, key, systemPrompt, userPrompt) {
    let retries = 2;
    while (retries >= 0) {
      try {
        if (provider === "gemini") {
          const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [
                {
                  role: "user",
                  parts: [{ text: `${systemPrompt}\n\nUser Request: ${userPrompt}` }]
                }
              ]
            })
          });
          const data = await res.json();
          if (data.error) {
            const isOverloaded = res.status === 503 || res.status === 429 || data.error.code === 503 || data.error.code === 429;
            if (isOverloaded && retries > 0) {
              retries--;
              await new Promise(r => setTimeout(r, 3000));
              continue;
            }
            throw new Error(data.error.message || JSON.stringify(data.error));
          }
          return data.candidates?.[0]?.content?.parts?.[0]?.text || "";

        } else if (provider === "openai" || provider === "groq" || provider === "openrouter") {
          const endpoint = provider === "groq"
            ? "https://api.groq.com/openai/v1/chat/completions"
            : provider === "openrouter"
            ? "https://openrouter.ai/api/v1/chat/completions"
            : "https://api.openai.com/v1/chat/completions";

          const headers = {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${key}`
          };
          if (provider === "openrouter") {
            headers["HTTP-Referer"] = "https://omnimodel.vercel.app";
            headers["X-Title"] = "Omni-Model Studio";
          }

          const res = await fetch(endpoint, {
            method: "POST",
            headers,
            body: JSON.stringify({
              model,
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: [{ type: "text", text: userPrompt }] }
              ]
            })
          });
          const data = await res.json();
          if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
          return data.choices?.[0]?.message?.content || "";

        } else if (provider === "claude") {
          const res = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": key,
              "anthropic-version": "2023-06-01"
            },
            body: JSON.stringify({
              model,
              system: systemPrompt,
              max_tokens: 4096,
              messages: [{ role: "user", content: userPrompt }]
            })
          });
          const data = await res.json();
          if (data.error) throw new Error(data.error.message);
          return data.content?.[0]?.text || "";
        }
      } catch (err) {
        if (retries > 0) {
          retries--;
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }
        throw err;
      }
    }
    return "";
  }

  try {
    const userIds = (await kvCmd("smembers", "all_agent_users")) || [];
    const executionResults = [];
    const now = Date.now();

    for (const userId of userIds) {
      const rawUserData = await kvCmd("get", `agent:user:${userId}`);
      if (!rawUserData) continue;

      const userConfig = typeof rawUserData === "string" ? JSON.parse(rawUserData) : rawUserData;
      const { 
        provider = "gemini", 
        apiKey, 
        model = "gemini-pro-latest", 
        active = true, 
        schedules = [] 
      } = userConfig;

      if (!active || !apiKey || !schedules.length) continue;

      let userFiles = userConfig.files || {};
      let userMemory = userConfig.longterm_memory || {};

      for (let i = 0; i < schedules.length; i++) {
        const sc = schedules[i];
        if (!sc.enabled) continue;
        const intervalMs = (parseInt(sc.intervalMinutes, 10) || 30) * 60 * 1000;
        const lastRun = sc.lastRun || 0;

        if (now - lastRun >= intervalMs) {
          let currentPrompt = `[SCHEDULED TASK TRIGGER: "${sc.id}"]\n${sc.prompt}`;
          let hops = 0;
          let taskDone = false;
          let lastReply = "";

          while (hops < 4 && !taskDone) {
            hops++;
            const currentFilesContext = JSON.stringify(userFiles, null, 2);
            const availableMemoryKeys = Object.keys(userMemory);
            const systemPrompt = getCronSystemPrompt(userConfig.rules || "", currentFilesContext, availableMemoryKeys);

            try {
              lastReply = await callProviderModel(provider, model, apiKey, systemPrompt, currentPrompt);

              let autoFollowUpPrompt = "";
              const planMatch = lastReply.match(/```agent_plan\s*([\s\S]*?)\s*```/);
              const toolCalls = [...lastReply.matchAll(/```tool_call\s*([\s\S]*?)\s*```/g)];

              for (const tc of toolCalls) {
                try {
                  const tool = JSON.parse(tc[1]);
                  if (tool.action === "finish") {
                    taskDone = true;
                    if (sc.id.startsWith("task_bg_")) {
                      schedules = schedules.filter(s => s.id !== sc.id);
                    }
                  } else if (tool.action === "remove_temp_schedules") {
                    const beforeCount = schedules.length;
                    if (tool.id) {
                      schedules = schedules.filter(s => s.id !== tool.id);
                    } else {
                      schedules = schedules.filter(s => !s.id.startsWith("task_bg_"));
                    }
                    const removed = beforeCount - schedules.length;
                    autoFollowUpPrompt = `[Cleanup Complete]: Removed ${removed} temporary handoff schedule(s). Proceed.`;
                  } else if (tool.action === "get_time") {
                    const timeRes = await agentGetTime(tool.timezone || "America/New_York");
                    if (planMatch && planMatch[1]) {
                      autoFollowUpPrompt = `[Time Data]:\n${timeRes}\n\nProceed to the next action in your plan.`;
                    } else {
                      lastReply = `🕒 ${timeRes}`;
                      taskDone = true;
                      autoFollowUpPrompt = "";
                    }
                  } else if (tool.action === "get_weather" && tool.location) {
                    const weatherRes = await agentGetWeather(tool.location);
                    if (planMatch && planMatch[1]) {
                      autoFollowUpPrompt = `[Live Weather Data for "${tool.location}"]:\n${weatherRes}\n\nProceed to the next action in your plan.`;
                    } else {
                      lastReply = `🌤️ ${weatherRes}`;
                      taskDone = true;
                      autoFollowUpPrompt = "";
                    }
                  } else if (tool.action === "read_longterm_memory" && tool.key) {
                    const rec = userMemory[tool.key];
                    const content = rec ? (typeof rec.content === "string" ? rec.content : JSON.stringify(rec.content)) : `Key "${tool.key}" not found in long-term memory.`;
                    autoFollowUpPrompt = `[Archived Long-Term Memory for "${tool.key}"]:\n${content}\n\nProceed with your objective.`;
                  } else if (tool.action === "set_schedule" && tool.id) {
                    const existingIdx = schedules.findIndex(s => s.id === tool.id);
                    const scheduleObj = {
                      id: tool.id,
                      sessionId: sc.sessionId || null,
                      mode: sc.mode || "general",
                      intervalMinutes: Math.max(1, parseInt(tool.intervalMinutes, 10) || 30),
                      prompt: tool.prompt || "Run scheduled routine.",
                      lastRun: Date.now(),
                      nextRun: Date.now() + ((parseInt(tool.intervalMinutes, 10) || 30) * 60 * 1000),
                      enabled: true
                    };
                    if (existingIdx !== -1) schedules[existingIdx] = scheduleObj;
                    else schedules.push(scheduleObj);
                  } else if (tool.action === "save_to_longterm_memory") {
                    let memContent = tool.content;
                    let memKey = tool.key || "memory_" + Date.now();
                    if (tool.from_file && userFiles[tool.from_file]) {
                      memContent = userFiles[tool.from_file];
                      memKey = tool.from_file;
                    }
                    if (memContent) {
                      userMemory[memKey] = { updatedAt: new Date().toISOString(), content: memContent };
                    }
                  } else if (tool.action === "create_file" && tool.filename) {
                    userFiles[tool.filename] = tool.content || "";
                  } else if (tool.action === "web_search" && tool.query) {
                    const results = await agentWebSearch(tool.query);
                    autoFollowUpPrompt = `[Web Search Results for "${tool.query}"]:\n${results}\n\nBased on this information, continue executing the goal.`;
                  } else if (tool.action === "web_fetch" && tool.url) {
                    const content = await agentWebFetch(tool.url);
                    if (!content.startsWith("Failed to fetch")) {
                      let parsedUrl;
                      try { parsedUrl = new URL(tool.url); } catch(e) {}

                      let rawName = tool.url.split("/").pop().split("?")[0] || "downloaded.txt";
                      if (!rawName.includes(".")) rawName += ".txt";

                      // Disambiguate generic files across domains
                      const genericNames = ["skill.md", "heartbeat.md", "rules.md", "rules.txt", "config.json", "api.md"];
                      let inferredName = rawName;
                      if (parsedUrl && genericNames.includes(rawName.toLowerCase())) {
                        const hostPrefix = parsedUrl.hostname.split(".")[0].replace(/[^a-zA-Z0-9_-]/g, "");
                        inferredName = `${hostPrefix}_${rawName}`;
                      }

                      userFiles[inferredName] = content;
                      autoFollowUpPrompt = `[Document Content from ${tool.url} saved as "${inferredName}"]:\n${content}\n\nRead these instructions carefully and proceed autonomously. Generic files are isolated with a domain prefix.`;
                    } else {
                      autoFollowUpPrompt = `[Fetch notice]: ${content}`;
                    }
                  } else if (tool.action === "http_request" && tool.url) {
                    const resp = await agentHttpRequest(tool.method || "GET", tool.url, tool.headers || {}, tool.body || null);
                    autoFollowUpPrompt = `[HTTP API Output]:\n${resp}\n\nAnalyze this response and proceed with the next action.`;
                  }
                } catch (tcErr) {}
              }

              const fileBlockRegex = /```(?:filepath:([^\s\n]+)|([a-zA-Z]*))\s*([\s\S]*?)\s*```/g;
              let match;
              while ((match = fileBlockRegex.exec(lastReply)) !== null) {
                const target = match[1];
                const content = match[3].trim();
                if (target && !match[0].includes("agent_plan") && !match[0].includes("tool_call")) {
                  userFiles[target] = content;
                }
              }

              if (autoFollowUpPrompt && !taskDone) {
                currentPrompt = autoFollowUpPrompt;
                await new Promise(r => setTimeout(r, 2000));
              } else {
                taskDone = true;
              }
            } catch (stepErr) {
              lastReply = `Cron run exception: ${stepErr.message}`;
              taskDone = true;
            }
          }

          if (schedules.find(s => s.id === sc.id)) {
            sc.lastRun = now;
            sc.nextRun = now + intervalMs;
            sc.enabled = true;
            sc.lastResult = lastReply.slice(0, 300);
          }

          executionResults.push({ userId, scheduleId: sc.id, hops, status: "Executed" });
        }
      }

      userConfig.files = userFiles;
      userConfig.longterm_memory = userMemory;
      userConfig.schedules = schedules;
      userConfig.updatedAt = new Date().toISOString();
      await kvCmd("set", `agent:user:${userId}`, JSON.stringify(userConfig));
    }

    return res.status(200).json({ success: true, processed: executionResults });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
