import { Redis } from "@upstash/redis";

export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const WS_API = "https://webshare.cz/api";

export async function loginToWebshare(username, password) {
  const res = await fetch(`${WS_API}/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "text/xml"
    },
    body: `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`
  });
  const xml = await res.text();
  const match = xml.match(/<status>(.*?)<\/status>.*<token>(.*?)<\/token>/s);
  if (!match || match[1] !== "OK") throw new Error("Neplatné přihlašovací údaje");
  return match[2];
}

export async function searchFiles(query, wst) {
  const res = await fetch(`${WS_API}/search?query=${encodeURIComponent(query)}&wst=${wst}`);
  const data = await res.json();
  return data.files || [];
}

export async function getFileLink(fileId, wst) {
  const res = await fetch(`${WS_API}/file_link/${fileId}?wst=${wst}`);
  const data = await res.json();
  return data.link;
}

export async function saveSession(sessionToken, wstToken, expiryInSecs = 86400) {
  await redis.set(`ws:session:${sessionToken}`, wstToken, { ex: expiryInSecs });
}

export async function getSession(sessionToken) {
  return await redis.get(`ws:session:${sessionToken}`);
}
