const fetch = require("node-fetch");
const xml2js = require("xml2js");
const Redis = require('ioredis');

// --- Inicializace Redis s ochranou proti výpadkům ---
const redis = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: 2,
  retryStrategy: times => {
    if (times > 5) return null; // Po 5 pokusech už se nepokoušej znovu
    return Math.min(times * 200, 2000); // zvyšující se prodleva
  }
});
redis.on('error', (err) => {
  console.error('[REDIS ERROR]', err);
});
// --- KONEC inicializace ---

const WS_API = "https://webshare.cz/api";

// Přihlášení do Webshare, získání WST tokenu
async function loginToWebshare(username, password) {
  const response = await fetch(`${WS_API}/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "text/xml"
    },
    body: `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`
  });

  const xml = await response.text();
  const parsed = await xml2js.parseStringPromise(xml);
  const status = parsed.response.status[0];
  const token = parsed.response.token ? parsed.response.token[0] : null;

  if (status !== "OK" || !token) throw new Error("Neplatné přihlašovací údaje");
  return token;
}

// Vyhledávání souborů na Webshare
async function searchFiles(query, wst) {
  const response = await fetch(`${WS_API}/search?query=${encodeURIComponent(query)}&wst=${wst}`);
  const json = await response.json();
  return json.files || [];
}

// Získání přímého odkazu na soubor
async function getFileLink(fileId, wst) {
  const response = await fetch(`${WS_API}/file_link/${fileId}?wst=${wst}`);
  const json = await response.json();
  return json.link;
}

// Uložení session tokenu do Redis (s expirací)
async function saveSession(sessionToken, wstToken, expiryInSecs = 86400) {
  if (!redis.status || redis.status !== "ready") throw new Error("Redis není dostupný");
  await redis.setex(`ws:session:${sessionToken}`, expiryInSecs, wstToken);
}

// Získání session tokenu z Redis
async function getSession(sessionToken) {
  if (!redis.status || redis.status !== "ready") throw new Error("Redis není dostupný");
  return await redis.get(`ws:session:${sessionToken}`);
}

module.exports = {
  loginToWebshare,
  searchFiles,
  getFileLink,
  saveSession,
  getSession
};
