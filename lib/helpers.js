const fetch = require("node-fetch");
const xml2js = require("xml2js");
const Redis = require('ioredis');

const redis = process.env.REDIS_URL 
  ? new Redis(process.env.REDIS_URL)
  : new Redis(); // Lokální Redis pro vývoj

const WS_API = "https://webshare.cz/api";

module.exports = {
  loginToWebshare: async (username, password) => {
    const response = await fetch(`${WS_API}/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "text/xml"
      },
      body: `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`
    });

    const xml = await response.text();
    const { response: { status, token } } = await xml2js.parseStringPromise(xml);
    if (status[0] !== "OK") throw new Error("Neplatné přihlašovací údaje");
    return token[0];
  },

  searchFiles: async (query, wst) => {
    const response = await fetch(`${WS_API}/search?query=${encodeURIComponent(query)}&wst=${wst}`);
    return (await response.json()).files || [];
  },

  getFileLink: async (fileId, wst) => {
    const response = await fetch(`${WS_API}/file_link/${fileId}?wst=${wst}`);
    return (await response.json()).link;
  },

  // Persistentní session storage
  saveSession: async (sessionToken, wstToken, expiryInSecs = 86400) => {
    await redis.setex(`ws:session:${sessionToken}`, expiryInSecs, wstToken);
  },

  getSession: async (sessionToken) => {
    return await redis.get(`ws:session:${sessionToken}`);
  }
};
