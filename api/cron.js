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

  // Helper for Upstash / Vercel KV REST execution
  async function kvCmd(...args) {
    const cmd = args[0];
    const rest = args.slice(1);
    const r = await fetch(`${kvUrl}/${cmd}/${rest.map(encodeURIComponent).join("/")}`, {
      headers: { Authorization: `Bearer ${kvToken}` }
    });
    const d = await r.json();
    return d.result;
  }

  // --- NATIVE AGENT TOOLS (REPLICATED FROM INDEX.HTML) ---
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

  function getCronSystemPrompt(customRules, currentFilesContext, longTermMemContext) {
    return `You are an Unconstrained Autonomous Problem Solver executing on the background serverless cron worker.
User custom instructions: ${customRules || ""}
Files:
${currentFilesContext}

[GLOBAL LONG-TERM MEMORY VAULT]:
${longTermMemContext}

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

8. Set Autonomous Recurring Schedule:
\`\`\`tool_call
{"action": "set_schedule", "id": "task_id", "intervalMinutes": 30, "prompt": "Your recurring task prompt."}
\`\`\`

Always continue executing autonomously until the final objective is fulfilled, then call the "finish" tool action.`;
  }

  // --- MULTI-PROVIDER MODEL CALL (GEMINI, OPENAI, CLAUDE, OPENROUTER, GROQ) ---
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
          if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
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

  // --- DISPATCHER & AUTONOMOUS LOOP ---
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

      for (const sc of schedules) {
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
            const longTermMemContext = JSON.stringify(userMemory, null, 2);
            const systemPrompt = getCronSystemPrompt(userConfig.rules || "", currentFilesContext, longTermMemContext);

            try {
              lastReply = await callProviderModel(provider, model, apiKey, systemPrompt, currentPrompt);

              let autoFollowUpPrompt = "";
              const toolCalls = [...lastReply.matchAll(/```tool_call\s*([\s\S]*?)\s*```/g)];

              for (const tc of toolCalls) {
                try {
                  const tool = JSON.parse(tc[1]);
                  if (tool.action === "finish") {
                    taskDone = true;
                  } else if (tool.action === "set_schedule" && tool.id) {
                    const existingIdx = schedules.findIndex(s => s.id === tool.id);
                    const scheduleObj = {
                      id: tool.id,
                      intervalMinutes: Math.max(1, parseInt(tool.intervalMinutes, 10) || 30),
                      prompt: tool.prompt || "Run scheduled routine.",
                      lastRun: Date.now(),
                      nextRun: Date.now() + ((tool.intervalMinutes || 30) * 60 * 1000),
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
                    let inferredName = tool.url.split("/").pop().split("?")[0] || "downloaded.txt";
                    if (!inferredName.includes(".")) inferredName += ".txt";
                    userFiles[inferredName] = content;
                    autoFollowUpPrompt = `[Document Content from ${tool.url} saved as "${inferredName}"]:\n${content}\n\nRead these instructions carefully and proceed autonomously with the next step.`;
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

          sc.lastRun = now;
          sc.lastResult = lastReply.slice(0, 300);

          if (sc.id.startsWith("handoff_")) {
            sc.enabled = false;
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
