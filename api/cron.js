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

  async function agentGetWeather(location = "London", unit = "F") {
    try {
      const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=en&format=json`);
      if (!geoRes.ok) return `Geocoding lookup failed for "${location}".`;
      const geoData = await geoRes.json();
      if (!geoData.results || !geoData.results.length) {
        return `Location "${location}" not found.`;
      }
      const { latitude, longitude, name, admin1, country } = geoData.results[0];
      
      const isFahrenheit = String(unit).toUpperCase().includes("F");
      const tempQuery = isFahrenheit ? "&temperature_unit=fahrenheit&wind_speed_unit=mph" : "";
      const tempSymbol = isFahrenheit ? "°F" : "°C";
      const windSymbol = isFahrenheit ? "mph" : "km/h";

      const weatherRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m${tempQuery}&timezone=auto`);
      if (!weatherRes.ok) return `Weather lookup failed for "${location}".`;
      const wData = await weatherRes.json();
      const cur = wData.current;
      return `Weather for ${name}${admin1 ? ', ' + admin1 : ''}, ${country}:
- Temperature: ${cur.temperature_2m}${tempSymbol} (Feels like: ${cur.apparent_temperature}${tempSymbol})
- Relative Humidity: ${cur.relative_humidity_2m}${"%"}
- Wind Speed: ${cur.wind_speed_10m} ${windSymbol}
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
      const googleUrl = `https://www.google.com/search?q=${encoded}&hl=en&gl=us&num=7`;
      const res = await fetch(googleUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9"
        }
      });

      if (res.ok) {
        const html = await res.text();
        const blockRegex = /<div class="(?:MjjYud|g|tF2C2)"[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>[\s\S]*?<a[^>]+href="(https?:\/\/[^"]+)"[\s\S]*?(?:<div class="VwiC3b[^"]*"[^>]*>([\s\S]*?)<\/div>|)/g;
        let match;
        const results = [];

        while ((match = blockRegex.exec(html)) !== null && results.length < 5) {
          const title = match[1].replace(/<[^>]+>/g, "").trim();
          const href = match[2];
          const rawSnippet = match[3] ? match[3].replace(/<[^>]+>/g, "").trim() : "";
          const snippet = rawSnippet ? rawSnippet : "No description.";
          if (title && href && !href.includes("google.com/search")) {
            results.push(`• **${title}**: ${snippet} (${href})`);
          }
        }
        if (results.length) return results.join("\n\n");
      }

      const ddgUrl = `https://html.duckduckgo.com/html/?q=${encoded}`;
      const ddgRes = await fetch(ddgUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
      });

      if (ddgRes.ok) {
        const ddgHtml = await ddgRes.text();
        const snippetMatches = [...ddgHtml.matchAll(/class="result__snippet[^"]*">([\s\S]*?)<\/a>/g)];
        let results = [];
        for (let i = 0; i < Math.min(snippetMatches.length, 5); i++) {
          const snippet = snippetMatches[i][1].replace(/<[^>]+>/g, "").trim();
          if (snippet) results.push(`• ${snippet}`);
        }
        if (results.length) return results.join("\n\n");
      }

      return `No direct search matches found for "${query}".`;
    } catch (err) {
      return `Search error: ${err.message}`;
    }
  }

  function getCronSystemPrompt(customRules, currentFilesContext, availableMemoryKeys, userProfileContext) {
    return `You are an Unconstrained Autonomous Problem Solver executing on the background serverless cron worker.
User custom instructions: ${customRules || ""}

USER CONTEXT:
${JSON.stringify(userProfileContext || {}, null, 2)}

PRIMARY WORKSPACE FILES:
${currentFilesContext}

[AVAILABLE LONG-TERM MEMORY KEYS]:
${JSON.stringify(availableMemoryKeys)}

PLATFORM & CREDENTIAL ISOLATION:
- Match filenames explicitly to prevent cross-service leaks.

ACTION & EXECUTION ENFORCEMENT PROTOCOL:
- NEVER claim an action is finished simply because you read documentation, summarized a memory key, or outlined steps.
- When the task requires creating an account, posting data, interacting with a platform, or calling an external service, you MUST inspect instructions (such as skill.md or docs), find the exact endpoint, build the payload, and execute the actual "http_request" or network tool action.
- You are STRICTLY FORBIDDEN from calling the "finish" tool action until the live execution request has been submitted and returned a real response. Summarizing a service does NOT complete an action on it.
- ONCE THE CREDENTIALS OR REGISTRATION SUCCEED: You MUST clean all temporary background tasks using "remove_temp_schedules" to prevent duplicate registration loops.

AUTONOMOUS SERVICE DISCOVERY & ONBOARDING PROTOCOL:
1. TARGETED IDEMPOTENCY & IDENTITY RULE:
   - YOU (the AI assistant) are the autonomous agent. The human user is your owner / operator.
   - When vault memory contains bot credentials, YOU are the registered bot account, NOT the user!
   - When asked about registration for that service:
     If valid credentials already exist in vault memory for that requested platform:
     DO NOT register again! Clean temporary tasks, report that your agent account already exists, provide the claim details, and call:
     \`\`\`tool_call
     {"action": "finish", "message": "My agent account is already registered and active."}
     \`\`\`
   - For all other tasks, execute the objective normally without false stops.
2. CONTEXTUAL RELEVANCE RULE:
   - Only execute service onboarding when explicitly requested to sign up, register, or post.
3. ONBOARDING SEQUENCE:
   - Step A: If you do not have the direct URL or instructions for the requested service, use "web_search" to find its site or "web_fetch" to fetch its root page.
   - Step B: Inspect the fetched content or check standard agent endpoints (e.g. root domain + "/skill.md", "/api", or discovery docs).
   - Step C: Once the skill or API instructions are fetched, save or read them immediately.
   - Step D: Identify the required registration/action endpoint, headers, and JSON body.
   - Step E: Use "http_request" to execute the POST/action directly.
4. Anti-Looping Rule: Never read notes.txt or memory keys more than once per goal. Once the platform name or concept is known, immediately proceed to Step A (web_search / web_fetch).
5. Post-Registration Cleanup: Clean temporary continuation schedules immediately after receiving credentials.
6. Completion Rule: Never call "finish" until the real registration or target API request has completed and returned its response payload, UNLESS targeted credentials already exist as defined in Rule 1.

TEACHING & EXAMPLES WRAPPER PROTOCOL:
- When demonstrating or explaining tools without executing, use:
\`\`\`example_snippet
{"action": "...", ...}
\`\`\`
Never use \`\`\`tool_call or \`\`\`filepath: for demonstrative code!

LINE-BASED FILE EDITING:
- Inspect with "read_file_lines" and patch with "edit_file_lines".

AVAILABLE TOOL ACTIONS:
1. Multi-Step Plan:
\`\`\`agent_plan
["Step 1: description", "Step 2: description"]
\`\`\`

2. Read File Lines:
\`\`\`tool_call
{"action": "read_file_lines", "filename": "index.html", "startLine": 1, "endLine": 40}
\`\`\`

3. Edit Specific Lines:
\`\`\`tool_call
{"action": "edit_file_lines", "filename": "index.html", "startLine": 10, "endLine": 20, "newContent": "replacement code"}
\`\`\`

4. Full File Creation / Overwrite:
\`\`\`tool_call
{"action": "create_file", "filename": "filename.ext", "content": "..."}
\`\`\`

5. Web Search:
\`\`\`tool_call
{"action": "web_search", "query": "search query here"}
\`\`\`

6. Web Page / Documentation Fetch:
\`\`\`tool_call
{"action": "web_fetch", "url": "https://example.com/file.md"}
\`\`\`

7. HTTP Request:
\`\`\`tool_call
{"action": "http_request", "method": "POST", "url": "https://api.example.com", "headers": {"Authorization": "Bearer key"}, "body": {"key": "val"}}
\`\`\`

8. Explicit Goal Complete:
\`\`\`tool_call
{"action": "finish", "message": "Objective completed successfully."}
\`\`\`

9. Read Specific Long-Term Memory:
\`\`\`tool_call
{"action": "read_longterm_memory", "key": "memory_key"}
\`\`\`

10. Save to Long-Term Memory:
\`\`\`tool_call
{"action": "save_to_longterm_memory", "key": "memory_key", "content": "Data to store..."}
\`\`\`

11. Save User Profile Details:
\`\`\`tool_call
{"action": "save_user_profile", "updates": {"location": "...", "timezone": "...", "tempUnit": "F", "role": "...", "projects": "..."}}
\`\`\`

12. Remove Temporary Continuation Schedules:
\`\`\`tool_call
{"action": "remove_temp_schedules"}
\`\`\`

13. Set Autonomous Recurring Schedule:
\`\`\`tool_call
{"action": "set_schedule", "id": "task_id", "intervalMinutes": 30, "prompt": "Your recurring task prompt."}
\`\`\`

14. Get Current Time & Date:
\`\`\`tool_call
{"action": "get_time", "timezone": "${userProfileContext?.timezone || "America/New_York"}"}
\`\`\`

15. Get Live Weather:
\`\`\`tool_call
{"action": "get_weather", "location": "${userProfileContext?.location \vert{}\vert{} "Miami, FL"}", "unit": "${userProfileContext?.tempUnit || "F"}"}
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
            headers: {
              "Content-Type": "application/json",
              "x-api-key": key,
              "anthropic-version": "2023-06-01"
            },
            method: "POST",
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
      let userProfile = userConfig.profile || {};

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
          let lastToolExecutedSummary = "";

          while (hops < 6 && !taskDone) {
            const currentFilesContext = JSON.stringify(userFiles, null, 2);
            const availableMemoryKeys = Object.keys(userMemory);
            const systemPrompt = getCronSystemPrompt(userConfig.rules || "", currentFilesContext, availableMemoryKeys, userProfile);

            try {
              lastReply = await callProviderModel(provider, model, apiKey, systemPrompt, currentPrompt);

              let autoFollowUpPrompt = "";
              let burnedRealHop = false;
              const planMatch = lastReply.match(/```agent_plan\s*([\s\S]*?)\s*```/);
              let parsedPlan = null;
              if (planMatch && planMatch[1]) {
                try { parsedPlan = JSON.parse(planMatch[1]); } catch(e) {}
              }
              const toolCalls = [...lastReply.matchAll(/```tool_call\s*([\s\S]*?)\s*```/g)];

              if (parsedPlan && parsedPlan.length > 0 && toolCalls.length === 0) {
                autoFollowUpPrompt = `[PLAN INITIALIZED]: Plan accepted. Proceed immediately with executing Step 1: "${parsedPlan[0]}". Call the required tool actions now.`;
                burnedRealHop = true;
                lastToolExecutedSummary = `Initialized agent plan with ${parsedPlan.length} steps.`;
              }

              for (const tc of toolCalls) {
                try {
                  const tool = JSON.parse(tc[1]);

                  if (
                    tool.action !== "remove_temp_schedules" && 
                    tool.action !== "read_longterm_memory" && 
                    tool.action !== "get_time"
                  ) {
                    burnedRealHop = true;
                  }

                  if (tool.action === "finish") {
                    taskDone = true;
                    lastToolExecutedSummary = `Finished mission: ${tool.message || "Done"}`;
                    schedules = schedules.filter(s => !s.id.startsWith("task_bg_"));
                  } else if (tool.action === "save_user_profile" && tool.updates) {
                    userProfile = { ...userProfile, ...tool.updates };
                    autoFollowUpPrompt = `[User Details Profile Updated]: ${JSON.stringify(userProfile)}\n\nUse this context to proceed.`;
                    lastToolExecutedSummary = `Saved user profile details.`;
                  } else if (tool.action === "read_file_lines" && tool.filename) {
                    const content = userFiles[tool.filename] || "";
                    const lines = content.split("\n");
                    const start = Math.max(1, parseInt(tool.startLine, 10) || 1);
                    const end = Math.min(lines.length, parseInt(tool.endLine, 10) || lines.length);
                    const numbered = lines.slice(start - 1, end).map((line, idx) => `${start + idx} | ${line}`).join("\n");
                    autoFollowUpPrompt = `[File Lines: ${tool.filename} (lines ${start}-${end} of ${lines.length})]:\n${numbered}\n\nProceed with your edits.`;
                    lastToolExecutedSummary = `Read lines ${start}-${end} of ${tool.filename}.`;

                  } else if (tool.action === "edit_file_lines" && tool.filename) {
                    const content = userFiles[tool.filename] || "";
                    const lines = content.split("\n");
                    const start = Math.max(1, parseInt(tool.startLine, 10) || 1);
                    const end = Math.min(lines.length, parseInt(tool.endLine, 10) || lines.length);
                    const newLines = (tool.newContent || "").split("\n");

                    lines.splice(start - 1, (end - start + 1), ...newLines);
                    userFiles[tool.filename] = lines.join("\n");
                    autoFollowUpPrompt = `[Lines Replaced]: Replaced lines ${start}-${end} in "${tool.filename}". Total lines now: ${lines.length}. Continue with next steps.`;
                    lastToolExecutedSummary = `Patched lines ${start}-${end} in ${tool.filename}.`;

                  } else if (tool.action === "remove_temp_schedules") {
                    const beforeCount = schedules.length;
                    if (tool.id) {
                      schedules = schedules.filter(s => s.id !== tool.id);
                    } else {
                      schedules = schedules.filter(s => !s.id.startsWith("task_bg_"));
                    }
                    const removed = beforeCount - schedules.length;
                    autoFollowUpPrompt = `[Cleanup Complete]: Removed ${removed} temporary handoff schedule(s). Proceed.`;
                    lastToolExecutedSummary = `Cleaned up ${removed} temp continuation schedules.`;

                  } else if (tool.action === "get_time") {
                    const targetTz = tool.timezone || userProfile.timezone || "America/New_York";
                    const timeRes = await agentGetTime(targetTz);
                    if (planMatch && planMatch[1]) {
                      autoFollowUpPrompt = `[Time Data]:\n${timeRes}\n\nProceed to the next action in your plan.`;
                    } else {
                      lastReply = `🕒 ${timeRes}`;
                      taskDone = true;
                      autoFollowUpPrompt = "";
                    }
                    lastToolExecutedSummary = `Retrieved system time (${targetTz}).`;

                  } else if (tool.action === "get_weather") {
                    const targetLoc = tool.location || userProfile.location || "Miami, FL";
                    const targetUnit = tool.unit || userProfile.tempUnit || "F";
                    const weatherRes = await agentGetWeather(targetLoc, targetUnit);
                    if (planMatch && planMatch[1]) {
                      autoFollowUpPrompt = `[Live Weather Data for "${targetLoc}"]:\n${weatherRes}\n\nProceed to the next action in your plan.`;
                    } else {
                      lastReply = `🌤️ ${weatherRes}`;
                      taskDone = true;
                      autoFollowUpPrompt = "";
                    }
                    lastToolExecutedSummary = `Checked weather for ${targetLoc} (${targetUnit}).`;

                  } else if (tool.action === "read_longterm_memory" && tool.key) {
                    const rec = userMemory[tool.key];
                    const content = rec ? (typeof rec.content === "string" ? rec.content : JSON.stringify(rec.content)) : `Key "${tool.key}" not found in long-term memory.`;
                    autoFollowUpPrompt = `[Archived Long-Term Memory for "${tool.key}"]:\n${content}\n\nCONTEXT LOADED: Address the task using this information. Do NOT trigger false stops if the user requested a different service or an unrelated task.`;
                    lastToolExecutedSummary = `Read memory key "${tool.key}".`;

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
                    lastToolExecutedSummary = `Registered schedule "${tool.id}".`;

                  } else if (tool.action === "save_to_longterm_memory") {
                    let memContent = tool.content;
                    let memKey = tool.key || "memory_" + Date.now();
                    if (tool.from_file && userFiles[tool.from_file]) {
                      memContent = userFiles[tool.from_file];
                      memKey = tool.from_file;
                    }
                    if (memContent) {
                      userMemory[memKey] = { updatedAt: new Date().toISOString(), content: memContent };
                      if (typeof memContent === "string" && (memContent.includes("api_key") || memContent.includes("registered") || memContent.includes("token"))) {
                        schedules = schedules.filter(s => !s.id.startsWith("task_bg_"));
                      }
                    }
                    lastToolExecutedSummary = `Saved long-term memory vault key "${memKey}".`;

                  } else if (tool.action === "create_file" && tool.filename) {
                    userFiles[tool.filename] = tool.content || "";
                    autoFollowUpPrompt = `[File Created]: '${tool.filename}' created. Proceed immediately with writing its code or moving to the next step.`;
                    lastToolExecutedSummary = `Created/Updated workspace file "${tool.filename}".`;

                  } else if (tool.action === "web_search" && tool.query) {
                    const results = await agentWebSearch(tool.query);
                    autoFollowUpPrompt = `[Web Search Results for "${tool.query}"]:\n${results}\n\nBased on this information, continue executing the goal.`;
                    lastToolExecutedSummary = `Searched web for "${tool.query}".`;

                  } else if (tool.action === "web_fetch" && tool.url) {
                    const content = await agentWebFetch(tool.url);
                    if (!content.startsWith("Failed to fetch")) {
                      let parsedUrl;
                      try { parsedUrl = new URL(tool.url); } catch(e) {}

                      let rawName = tool.url.split("/").pop().split("?")[0] || "downloaded.txt";
                      if (!rawName.includes(".")) rawName += ".txt";

                      const genericNames = ["skill.md", "heartbeat.md", "rules.md", "rules.txt", "config.json", "api.md"];
                      let inferredName = rawName;
                      if (parsedUrl && genericNames.includes(rawName.toLowerCase())) {
                        const hostPrefix = parsedUrl.hostname.split(".")[0].replace(/[^a-zA-Z0-9_-]/g, "");
                        inferredName = `${hostPrefix}_${rawName}`;
                      }

                      userFiles[inferredName] = content;
                      autoFollowUpPrompt = `[Document Content from ${tool.url} saved as "${inferredName}"]:\n${content}\n\nRead these instructions carefully and proceed autonomously. Generic files are isolated with a domain prefix.`;
                      lastToolExecutedSummary = `Fetched and stored "${tool.url}" as "${inferredName}".`;
                    } else {
                      autoFollowUpPrompt = `[Fetch notice]: ${content}`;
                      lastToolExecutedSummary = `Attempted fetch of "${tool.url}".`;
                    }
                  } else if (tool.action === "http_request" && tool.url) {
                    const resp = await agentHttpRequest(tool.method || "GET", tool.url, tool.headers || {}, tool.body || null);
                    autoFollowUpPrompt = `[HTTP API Output]:\n${resp}\n\nAnalyze this response and proceed with the next action. If this fulfilled the objective (e.g. account created or message sent), save any credentials to long-term memory, clean temporary schedules, and finish.`;
                    lastToolExecutedSummary = `HTTP ${tool.method || "GET"} to "${tool.url}".`;
                  }
                } catch (tcErr) {}
              }

              const fileBlockRegex = /```filepath:([^\s\n]+)\s*([\s\S]*?)```/g;
              let match;
              while ((match = fileBlockRegex.exec(lastReply)) !== null) {
                const target = match[1];
                const content = match[2].trim();
                if (target && !match[0].includes("agent_plan") && !match[0].includes("tool_call") && !match[0].includes("example_snippet")) {
                  userFiles[target] = content;
                }
              }

              if (burnedRealHop) {
                hops++;
              }

              if (autoFollowUpPrompt && !taskDone) {
                currentPrompt = `[CONTINUE TASK - RESUMPTION PAYLOAD]
Last Completed Action: ${lastToolExecutedSummary || "Completed intermediate step."}
Next Immediate Step:
${autoFollowUpPrompt}

CRITICAL DIRECTIVE:
You have ALREADY verified prerequisite context. Do NOT call "read_longterm_memory". Directly execute the concrete network/API action required above. Once completed, clean temporary schedules immediately.`;
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
      userConfig.profile = userProfile;
      userConfig.schedules = schedules;
      userConfig.updatedAt = new Date().toISOString();
      await kvCmd("set", `agent:user:${userId}`, JSON.stringify(userConfig));
    }

    return res.status(200).json({ success: true, processed: executionResults });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
