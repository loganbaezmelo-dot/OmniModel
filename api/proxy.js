// api/proxy.js
export default async function handler(req, res) {
  // Allow OmniModel to talk to this endpoint cleanly
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,PATCH,DELETE,POST,PUT");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "X-CSRF-TokenUsing a native Node.js backend solves this completely. When the Node server issues requests instead of the browser, CORS restrictions do not apply, preflight checks disappear, and third-party public proxies are no longer necessary 😭💀.

Because the app is deployed on Vercel, this can be set up in two files without configuring extra infrastructure.

---

### Step 1: Create the Serverless Backend Endpoint

In your project repository, create a directory named `api` and place `proxy.js` inside it:

**`api/proxy.js`**
```javascript
export default async function handler(req, res) {
  // Allow the frontend app to call this backend route
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  // Handle CORS preflight check
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const { targetUrl, method = "GET", headers = {}, body = null } = req.body || req.query;

  if (!targetUrl) {
    return res.status(400).json({ error: "targetUrl is required" });
  }

  try {
    const fetchOptions = {
      method: method.toUpperCase(),
      headers: {
        "User-Agent": "OmniModel-Agent-Runtime/1.0",
        ...headers
      }
    };

    if (body && method.toUpperCase() !== "GET") {
      fetchOptions.body = typeof body === "string" ? body : JSON.stringify(body);
      if (!fetchOptions.headers["Content-Type"]) {
        fetchOptions.headers["Content-Type"] = "application/json";
      }
    }

    const response = await fetch(targetUrl, fetchOptions);
    const contentType = response.headers.get("content-type") || "";
    
    let responseData;
    if (contentType.includes("application/json")) {
      responseData = await response.json();
      return res.status(response.status).json(responseData);
    } else {
      responseData = await response.text();
      return res.status(response.status).send(responseData);
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
