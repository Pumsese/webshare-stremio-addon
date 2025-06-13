import { loginToWebshare, searchFiles, getFileLink, saveSession, getSession, stripDiacritics } from "../lib/helpers.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BASE_URL = "https://webshare-stremio-addon.vercel.app";
const TMDB_API_KEY = "d835bb938c706fe1f24bed4a81b1f5d3";

const VIDEO_EXTENSIONS = [".mp4", ".mkv", ".avi", ".mov", ".webm", ".ts"];

const manifest = {
  id: "cz.webshare.stremio",
  version: "1.0.0",
  name: "Webshare Stremio",
  description: "Streamování z Webshare s přihlášením (bez databáze, podpora tokenu a cookies)",
  resources: ["catalog", "stream"],
  types: ["movie", "series"],
  catalogs: [
    {
      type: "movie",
      id: "webshare-search",
      name: "Webshare vyhledávání",
      extra: [
        { name: "search", isRequired: true },
        { name: "sessionToken", isRequired: true }
      ]
    },
    {
      type: "series",
      id: "webshare-search-series",
      name: "Webshare vyhledávání (seriály)",
      extra: [
        { name: "search", isRequired: true },
        { name: "sessionToken", isRequired: true }
      ]
    }
  ],
  behaviorHints: {
    configurable: true
  }
};

function mapToMeta(file) {
  return {
    id: `ws_${file.ident}`,
    type: file.is_tv ? "series" : "movie",
    name: file.name,
    poster: file.thumbnail_url,
    description: `Kvalita: ${file.video_quality || ""} | ${(file.size / 1024 ** 2).toFixed(1)}MB`
  };
}

function createStream(link, file) {
  return {
    title: `${file?.name || "Webshare"} (${file?.size ? (file.size / 1024 ** 2).toFixed(1) + " MB" : ""})`,
    url: link,
    behaviorHints: { notWebReady: true }
  };
}

function isVideoFile(file) {
  if (!file || !file.name) return false;
  const name = file.name.toLowerCase();
  return VIDEO_EXTENSIONS.some(ext => name.endsWith(ext));
}

function normalizeString(str) {
  return stripDiacritics(str)
    .toLowerCase()
    .replace(/[\s\.\-_]+/g, "");
}

function fileMatchesPattern(file, titleVariants, patternVariants) {
  const normalizedName = normalizeString(file.name);
  return titleVariants.some(title =>
    patternVariants.some(pattern =>
      normalizedName.includes(normalizeString(title)) &&
      normalizedName.includes(normalizeString(pattern))
    )
  );
}

function fileMatchesPatternOnly(file, patternVariants) {
  const normalizedName = normalizeString(file.name);
  return patternVariants.some(pattern =>
    normalizedName.includes(normalizeString(pattern))
  );
}

function fileContainsAnyTitle(file, titleVariants) {
  const normalizedName = normalizeString(file.name);
  return titleVariants.some(title => normalizedName.includes(normalizeString(title)));
}

async function getShowTitles(imdbId) {
  const titles = [];
  try {
    const tmdbRes = await fetch(`https://api.themoviedb.org/3/find/${imdbId}?api_key=${TMDB_API_KEY}&external_source=imdb_id&language=cs-CZ`);
    const tmdbData = await tmdbRes.json();
    if (tmdbData.tv_results && tmdbData.tv_results.length > 0) {
      if (tmdbData.tv_results[0].name) titles.push(tmdbData.tv_results[0].name);
      if (tmdbData.tv_results[0].original_name) titles.push(tmdbData.tv_results[0].original_name);
    }
    const tmdbResEn = await fetch(`https://api.themoviedb.org/3/find/${imdbId}?api_key=${TMDB_API_KEY}&external_source=imdb_id&language=en-US`);
    const tmdbDataEn = await tmdbResEn.json();
    if (tmdbDataEn.tv_results && tmdbDataEn.tv_results.length > 0) {
      if (tmdbDataEn.tv_results[0].name) titles.push(tmdbDataEn.tv_results[0].name);
      if (tmdbDataEn.tv_results[0].original_name) titles.push(tmdbDataEn.tv_results[0].original_name);
    }
  } catch (e) {
    console.log("Chyba při získávání názvů z TMDB:", e);
  }
  return [...new Set(titles.filter(Boolean))];
}

function allPatterns(season, episode) {
  if (!season || !episode) return [];
  const s = season.toString().padStart(2, "0");
  const e = episode.toString().padStart(2, "0");
  return [
    `S${s}E${e}`,
    `S${season}E${episode}`,
    `${season}x${episode}`,
    `${season}x${e}`,
    `${season}.${episode}`,
    `${season}.${e}`,
    `${season}${episode}`,
    `${s}x${e}`,
    `${season} epizoda ${episode}`,
    `${season} díl ${episode}`,
    `${s}E${e}`,
    `${s}${e}`,
    `${season}e${episode}`,
    `${season}e${e}`,
    `${season} ep ${episode}`,
    `${season} part ${episode}`,
    `${episode}`,
  ];
}

export default async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") return res.end();

  // Přesměrování z / na /login
  if (req.url === "/" || req.url === "/index.html") {
    res.writeHead(302, { Location: "/login" });
    return res.end();
  }

  // Přihlašovací stránka
  if (req.url.startsWith("/login")) {
    if (req.method === "GET") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(fs.readFileSync(path.join(__dirname, "../public/login.html"), "utf8"));
      return;
    }
    if (req.method === "POST") {
      let body = "";
      req.on("data", chunk => body += chunk);
      req.on("end", async () => {
        try {
          const params = new URLSearchParams(body);
          const username = params.get("username");
          const password = params.get("password");
          const token = params.get("token");

          let loginResult;
          if (token) {
            // Pokud uživatel zadal token ručně, PHPSESSID nebude k dispozici
            loginResult = { token, phpsessid: null };
          } else if (username && password) {
            loginResult = await loginToWebshare(username, password);
          } else {
            throw new Error("Musíte zadat buď token, nebo uživatelské jméno a heslo");
          }

          const sessionToken = Math.random().toString(36).substr(2, 15);
          await saveSession(sessionToken, loginResult);

          const manifestUrl = `${BASE_URL}/manifest.json?sessionToken=${sessionToken}`;
          const stremioUrl = `stremio://addon/manifest.json?sessionToken=${sessionToken}&transportName=web&url=${encodeURIComponent(BASE_URL + "/manifest.json")}`;

          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(`
            <h2>Přihlášení úspěšné!</h2>
            <p>
              <b>Addon URL:</b><br>
              <a href="${manifestUrl}" target="_blank">${manifestUrl}</a>
            </p>
            <p>
              <b>Otevřít ve Stremiu:</b><br>
              <a href="${stremioUrl}" style="font-size:1.1em;font-weight:bold;color:#1976d2;">Přidat do Stremia</a>
            </p>
            <p>
              <small>Pokud se odkaz neotevře automaticky, zkopírujte URL a vložte ji do Stremia ručně.</small>
            </p>
          `);
        } catch (error) {
          res.writeHead(401, { "Content-Type": "text/html; charset=utf-8" });
          res.end(`<p style="color:red;">Chyba: ${error.message}</p>`);
        }
      });
      return;
    }
  }

  // Manifest endpoint
  if (req.url.startsWith("/manifest.json")) {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(manifest));
    return;
  }

  // Katalog a stream endpointy
  const url = new URL(req.url, `http://${req.headers.host}`);
  const resource = url.pathname.split("/")[1];
  const type = url.pathname.split("/")[2];
  let id = url.pathname.split("/")[3];
  const extra = Object.fromEntries(url.searchParams.entries());

  let cleanId = id || "";
  if (cleanId.endsWith(".json")) cleanId = cleanId.slice(0, -5);
  cleanId = decodeURIComponent(cleanId);

  if (resource === "catalog") {
    const sessionToken = extra.sessionToken;
    const search = extra.search;
    if (!search || !sessionToken) {
      console.log("KATALOG: Chybí search nebo sessionToken", { search, sessionToken });
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ metas: [] }));
      return;
    }
    const session = await getSession(sessionToken);
    if (!session || !session.token) {
      console.log("KATALOG: Neplatný sessionToken", sessionToken);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ metas: [], message: "Session vypršela – přihlaste se znovu na https://webshare-stremio-addon.vercel.app/login" }));
      return;
    }
    let files = [];
    try {
      files = await searchFiles(search, session.token, session.phpsessid, 100);
    } catch (e) {
      console.log("KATALOG: Chyba při volání searchFiles:", e);
      files = [];
    }
    console.log("KATALOG: Dotaz", search, "Výsledků:", files.length);
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ metas: files.map(mapToMeta) }));
    return;
  }

  if (resource === "stream") {
    const sessionToken = extra.sessionToken;
    if (!sessionToken) {
      console.log("STREAM: Chybí sessionToken");
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ streams: [] }));
      return;
    }
    const session = await getSession(sessionToken);
    if (!session || !session.token) {
      console.log("STREAM: Neplatný sessionToken", sessionToken);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ streams: [], message: "Session vypršela – přihlaste se znovu na https://webshare-stremio-addon.vercel.app/login" }));
      return;
    }

    let diagnostic = [];
    let relevantFiles = [];
    let patternFallbackFiles = [];
    if (cleanId.startsWith("ws_")) {
      // katalogový režim
      const fileIdent = cleanId.substring(3);
      const link = await getFileLink(fileIdent, session.token, session.phpsessid);
      if (link) {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ streams: [createStream(link, { name: `Soubor ${fileIdent}` })] }));
        return;
      } else {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ streams: [] }));
        return;
      }
    } else if (type === "series") {
      const [imdbId, seasonRaw, episodeRaw] = cleanId.split(":");
      const season = (seasonRaw || "").toString();
      const episode = (episodeRaw || "").toString();
      if (!imdbId || !season || !episode) {
        console.log("STREAM: Chybí imdbId, season nebo episode", { imdbId, season, episode });
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ streams: [] }));
        return;
      }
      const titles = await getShowTitles(imdbId);
      const allTitles = [...titles, ...titles.map(stripDiacritics)];
      const patterns = allPatterns(season, episode);

      for (const title of allTitles) {
        for (const pattern of patterns) {
          const query = `${title} ${pattern}`;
          let files = [];
          try {
            files = await searchFiles(query, session.token, session.phpsessid, 100);
          } catch (e) {
            console.log("STREAM: Chyba při volání searchFiles:", e);
            files = [];
          }
          diagnostic.push({ query, found: files.length });
          const videoFiles = files.filter(isVideoFile);
          const matched = videoFiles.filter(file => fileMatchesPattern(file, [title, stripDiacritics(title)], [pattern]));
          if (matched.length > 0) {
            relevantFiles = relevantFiles.concat(matched);
          }
          const fallbackMatched = videoFiles.filter(file =>
            fileMatchesPatternOnly(file, [pattern]) &&
            fileContainsAnyTitle(file, allTitles.concat(allTitles.map(stripDiacritics)))
          );
          if (fallbackMatched.length > 0) {
            patternFallbackFiles = patternFallbackFiles.concat(fallbackMatched);
          }
        }
      }
      if (!relevantFiles.length && patternFallbackFiles.length) {
        console.log("STREAM: Používám fallback na pattern+název, počet:", patternFallbackFiles.length);
        relevantFiles = patternFallbackFiles.slice(0, 15);
      }
      relevantFiles = [...new Map(relevantFiles.map(item => [item.ident, item])).values()];
      if (!relevantFiles.length) {
        console.log("STREAM: Žádný video soubor nenalezen. Zkoušené dotazy:", diagnostic);
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ streams: [] }));
        return;
      }
      console.log("STREAM: Relevantní soubory:", relevantFiles.map(f => f.name));
    } else if (type === "movie") {
      let files = [];
      let movieTitle = extra.search || cleanId;
      if (!movieTitle || movieTitle === cleanId) {
        console.log("STREAM: Chybí název filmu pro vyhledávání.");
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ streams: [] }));
        return;
      }
      try {
        files = await searchFiles(movieTitle, session.token, session.phpsessid, 100);
      } catch (e) {
        console.log("STREAM: Chyba při volání searchFiles:", e);
        files = [];
      }
      diagnostic.push({ query: movieTitle, found: files.length });
      const videoFiles = files.filter(isVideoFile);
      relevantFiles = videoFiles.filter(file =>
        fileContainsAnyTitle(file, [movieTitle, stripDiacritics(movieTitle)])
      );
      relevantFiles = relevantFiles.slice(0, 15);
      if (!relevantFiles.length) {
        console.log("STREAM: Film nenalezen (žádný video soubor). Zkoušené dotazy:", diagnostic);
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ streams: [] }));
        return;
      }
      console.log("STREAM: Relevantní soubory (film):", relevantFiles.map(f => f.name));
    }

    relevantFiles.sort((a, b) => (b.size || 0) - (a.size || 0));
    const streams = [];
    for (const file of relevantFiles) {
      const link = await getFileLink(file.ident, session.token, session.phpsessid);
      if (link) {
        streams.push(createStream(link, file));
      }
    }

    if (!streams.length) {
      console.log("STREAM: Žádný video soubor nemá funkční file_link.", relevantFiles.map(f => f.ident));
    }

    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ streams }));
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
};