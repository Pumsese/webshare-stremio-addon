const { addonBuilder } = require("stremio-addon-sdk");
const { loginToWebshare, searchFiles, getFileLink } = require("../lib/helpers");
const { loginSchema } = require("../lib/validation");
const { checkRateLimit } = require("../lib/rateLimit");
const logger = require("../lib/logger");
const fs = require("fs");
const path = require("path");

// Redis session storage
const { saveSession, getSession } = require("../lib/helpers");

const manifest = {
  id: "cz.webshare.stremio",
  version: "2.0.0",
  name: "Webshare Stremio Pro",
  description: "Premium přístup k Webshare s přihlášením a produkční ochranou",
  resources: ["catalog", "stream", "configure"],
  types: ["movie", "series"],
  catalogs: [{
    type: "movie",
    id: "webshare-search",
    name: "Vyhledat na Webshare",
    extra: [{ name: "search", isRequired: true }]
  }]
};

const builder = new addonBuilder(manifest);

// Konfigurační handler
builder.defineConfigHandler(() => ({
  config: [
    { key: "sessionToken", type: "text", title: "Session Token" }
  ],
  options: [{
    label: "Přihlásit se",
    action: { type: "link", url: "/login" }
  }]
}));

// Catalog handler
builder.defineCatalogHandler(async ({ extra, config }) => {
  try {
    const { search } = extra;
    const { sessionToken } = config;
    if (!search || !sessionToken) return { metas: [] };
    const wst = await getSession(sessionToken);
    if (!wst) return { metas: [] };

    const files = await searchFiles(search, wst);
    return { metas: files.map(mapToMeta) };
  } catch (error) {
    logger.error("Catalog error", { error: error.message });
    return { metas: [] };
  }
});

// Stream handler
builder.defineStreamHandler(async ({ id, config }) => {
  try {
    const [prefix, fileId] = id.split("_");
    const { sessionToken } = config;
    if (prefix !== "ws" || !sessionToken) return { streams: [] };
    const wst = await getSession(sessionToken);
    if (!wst) return { streams: [] };

    const link = await getFileLink(fileId, wst);
    return link ? { streams: [createStream(link)] } : { streams: [] };
  } catch (error) {
    logger.error("Stream error", { error: error.message });
    return { streams: [] };
  }
});

// HTTP handler
module.exports = async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") return res.end();

  // Rate limiting
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  if (!(await checkRateLimit(ip))) {
    res.writeHead(429, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "Příliš mnoho požadavků, zkuste to později" }));
  }

  if (req.url === "/login") {
    if (req.method === "GET") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(fs.readFileSync(path.join(__dirname, "../public/login.html"), "utf8"));
    } else if (req.method === "POST") {
      let body = "";
      req.on("data", chunk => body += chunk);
      req.on("end", async () => {
        try {
          const params = new URLSearchParams(body);
          const username = params.get("username");
          const password = params.get("password");

          // Validace vstupu
          const { error } = loginSchema.validate({ username, password });
          if (error) {
            res.writeHead(400, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ error: error.details[0].message }));
          }

          const wst = await loginToWebshare(username, password);
          const sessionToken = require("crypto").randomBytes(16).toString("hex");
          await saveSession(sessionToken, wst);

          logger.info("User logged in", { username });
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ sessionToken }));
        } catch (error) {
          logger.error("Login error", { error: error.message });
          res.writeHead(401, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: error.message }));
        }
      });
    }
  } else {
    // Stremio API
    builder.getInterface()(req, res);
  }
};

function mapToMeta(file) {
  return {
    id: `ws_${file.ident}`,
    type: file.is_tv ? "series" : "movie",
    name: file.name,
    poster: file.thumbnail_url,
    description: `Kvalita: ${file.video_quality} | ${(file.size / 1024 ** 2).toFixed(1)}MB`
  };
}

function createStream(link) {
  return {
    title: "Webshare Premium",
    url: link,
    behaviorHints: { notWebReady: true }
  };
}
