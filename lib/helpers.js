// helpers.js

import md5crypt from "unix-md5-crypt"; // OPRAVA: použij unix-md5-crypt z npm!
import sha1 from "js-sha1";
import { Redis } from "@upstash/redis";
import { parseStringPromise } from "xml2js";

const WS_API = "https://webshare.cz/api";

// Inicializace Upstash Redis klienta
const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN
});

export async function loginToWebshare(username, password) {
    // 1. Log původního hesla
    console.log("Webshare login - username:", username);
    console.log("Webshare login - password (plain):", password);

    // 2. OPRAVA: použij unix-md5-crypt s přesným solem "webshare"
    const md5hash = md5crypt(password, "webshare");
    console.log("Webshare login - md5crypt hash:", md5hash);

    // 3. Výsledek md5crypt zahashuj přes sha1
    const finalHash = sha1(md5hash);
    console.log("Webshare login - sha1(md5crypt) hash:", finalHash);

    // 4. Připrav POST data a hlavičky přesně dle Webshare API
    const postBody = `username_or_email=${encodeURIComponent(username)}&password=${finalHash}&keep_logged_in=1`;
    console.log("Webshare login - POST body:", postBody);

    const res = await fetch("https://webshare.cz/api/login/", {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "Accept": "text/xml; charset=UTF-8",
            "User-Agent": "Mozilla/5.0"
        },
        body: postBody
    });

    console.log("Webshare login - HTTP status:", res.status);

    const xml = await res.text();
    console.log("Webshare login - response XML:", xml);

    // Získání PHPSESSID z hlavičky Set-Cookie
    const setCookie = res.headers.get("set-cookie");
    let phpsessid = null;
    if (setCookie) {
        const match = setCookie.match(/PHPSESSID=([^;]+)/);
        if (match) phpsessid = match[1];
    }
    console.log("Webshare login - PHPSESSID:", phpsessid);

    // Získání statusu a tokenu z XML
    const statusMatch = xml.match(/<status>(.*?)<\/status>/s);
    const tokenMatch = xml.match(/<token>(.*?)<\/token>/s);

    if (!statusMatch || statusMatch[1] !== "OK") {
        // Získání chybové zprávy z XML
        const msgMatch = xml.match(/<message>(.*?)<\/message>/s);
        if (msgMatch) {
            console.log("Webshare login - error message:", msgMatch[1]);
            throw new Error(`Neplatné přihlašovací údaje: ${msgMatch[1]}`);
        }
        throw new Error("Neplatné přihlašovací údaje");
    }

    if (!tokenMatch) {
        console.log("Webshare login - token nebyl nalezen v odpovědi.");
        throw new Error("Přihlášení nevrátilo token.");
    }

    console.log("Webshare login - Úspěšné přihlášení, token:", tokenMatch[1]);
    return { token: tokenMatch[1], phpsessid };
}

// Vyhledávání souborů přes /api/file_search s podporou cookies
export async function searchFiles(query, wst, phpsessid = null, limit = 100, offset = 0) {
    try {
        const headers = {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "Accept": "text/xml; charset=UTF-8",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        };
        if (phpsessid) headers["Cookie"] = `PHPSESSID=${phpsessid}`;

        const res = await fetch(`${WS_API}/file_search/`, {
            method: "POST",
            headers,
            body: `string=${encodeURIComponent(query)}&wst=${encodeURIComponent(wst)}&limit=${limit}&offset=${offset}`
        });

        const text = await res.text();
        if (text.trim().startsWith("<error") || text.trim().startsWith("<!DOCTYPE")) {
            return [];
        }

        const result = await parseStringPromise(text);
        if (!result || !result.files || !result.files.file) return [];
        return result.files.file.map(file => ({
            ident: file.ident[0],
            name: file.name[0],
            type: file.type[0],
            size: file.size ? parseInt(file.size[0]) : undefined,
            video_quality: file.video_quality ? file.video_quality[0] : undefined,
            thumbnail_url: file.thumbnail_url ? file.thumbnail_url[0] : undefined,
            is_tv: file.is_tv ? file.is_tv[0] === "1" : false
        }));
    } catch (e) {
        console.log("Chyba při parsování XML z Webshare API (file_search):", e);
        return [];
    }
}

// Získání odkazu na soubor – správně POST a kontrola odpovědi, s podporou cookies
export async function getFileLink(fileId, wst, phpsessid = null) {
    try {
        const headers = {
            "Accept": "text/xml; charset=UTF-8",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        };
        if (phpsessid) headers["Cookie"] = `PHPSESSID=${phpsessid}`;
        const res = await fetch(`${WS_API}/file_link/`, {
            method: "POST",
            headers,
            body: `ident=${encodeURIComponent(fileId)}&wst=${encodeURIComponent(wst)}`
        });
        const text = await res.text();
        if (text.trim().startsWith("<error") || text.trim().startsWith("<!DOCTYPE")) {
            return null;
        }
        const result = await parseStringPromise(text);
        if (result && result.file_link && result.file_link.link) {
            return result.file_link.link[0];
        }
        return null;
    } catch (e) {
        console.log("Chyba při získávání odkazu na soubor:", e);
        return null;
    }
}

// Uložení session do Redis
export async function saveSession(sessionToken, sessionData) {
    await redis.setex(`ws:session:${sessionToken}`, 60 * 60 * 12, JSON.stringify(sessionData));
}

// Získání session z Redis
export async function getSession(sessionToken) {
    const data = await redis.get(`ws:session:${sessionToken}`);
    if (!data) return null;
    try {
        return JSON.parse(data);
    } catch {
        return null;
    }
}

// Odstranění diakritiky
export function stripDiacritics(str) {
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
