import { addonBuilder } from "stremio-addon-sdk";
import { loginToWebshare, searchFiles, getFileLink, saveSession, getSession } from "../lib/helpers.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const manifest = {
  id: "cz.webshare.stremio",
  version: "1.0.0",
  name: "Webshare Stremio",
  description: "Streamování z Webshare s přihlášením (Upstash Redis)",
  resources: ["catalog", "stream"],
  types: ["movie", "series"],
  catalogs: [{
    type: "movie",
    id: "webshare-search",
    name: "Webshare vyhledávání",
    extra: [{ name: "search", isRequired: true }]
  }],
  behaviorHints: {
    configurable: true,
    configurationRequired: true
  }
};

const builder = new addonBuilder(manifest);

builder.defineCatalogHandler(async ({ extra }, req) => {
  const { search } = extra;
  const sessionToken = (req && req.query && req.query.sessionToken) || (extra && extra.sessionToken);
  if (!search || !sessionToken) return { metas: [] };
  const wst = await getSession(sessionToken);
  if (!wst) return { metas: [] };
  const files = await searchFiles(search, wst);
  return { metas: files.map(mapToMeta) };
});

builder.defineStreamHandler(async ({ id }, req) => {
  const [prefix, fileId] = id.split("_");
  const sessionToken = req && req.query && req.query.sessionToken;
  if (prefix !== "ws" || !sessionToken) return { streams: [] };
  const wst = await getSession(sessionToken);
  if (!wst) return { streams: [] };
  const link = await getFileLink(fileId, wst);
  return link ? { streams: [createStream(link)] } : { streams: [] };
});

export default async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") return res.end();

  if (req.url.startsWith("/login")) {
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
          const wst = await loginToWebshare(username, password);
          const sessionToken = Math.random().toString(36).substr(2, 15);
          await saveSession(sessionToken, wst);
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(`
            <h2>Přihlášení úspěšné!</h2>
            <p>Zkopírujte si tento session token a použijte ho v URL addonu ve Stremiu:</p>
            <input type="text" value="${sessionToken}" readonly style="width:300px;">
            <p>Příklad URL: <code>https://tvuj-addon.vercel.app/manifest.json?sessionToken=${sessionToken}</code></p>
          `);
        } catch (error) {
          res.writeHead(401, { "Content-Type": "text/html" });
          res.end(`<p style="color:red;">Chyba: ${error.message}</p>`);
        }
      });
    }
  } else {
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
