// lib/md5crypt.js
import crypto from "crypto";

const itoa64 = "./0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function to64(v, n) {
    let s = '';
    while (--n >= 0) {
        s += itoa64[v & 0x3f];
        v = v >> 6;
    }
    return s;
}

export function md5crypt(key, salt) {
    // Webshare používá salt "$1$webshare"
    const matches = /^\$1\$(.{1,8})/.exec(salt);
    salt = matches ? matches[1] : salt;

    let magic = "$1$";
    let ctx = key + magic + salt;
    let final = md5(key + salt + key);

    for (let pl = key.length; pl > 0; pl -= 16) {
        ctx += final.substr(0, pl > 16 ? 16 : pl);
    }

    for (let i = key.length; i; i >>= 1) {
        ctx += (i & 1) ? String.fromCharCode(0) : key[0];
    }

    final = md5(ctx);

    for (let i = 0; i < 1000; i++) {
        let ctx1 = '';
        ctx1 += (i & 1) ? key : final;
        if (i % 3) ctx1 += salt;
        if (i % 7) ctx1 += key;
        ctx1 += (i & 1) ? final : key;
        final = md5(ctx1);
    }

    let passwd = '';
    passwd += to64((final.charCodeAt(0) << 16) | (final.charCodeAt(6) << 8) | final.charCodeAt(12), 4);
    passwd += to64((final.charCodeAt(1) << 16) | (final.charCodeAt(7) << 8) | final.charCodeAt(13), 4);
    passwd += to64((final.charCodeAt(2) << 16) | (final.charCodeAt(8) << 8) | final.charCodeAt(14), 4);
    passwd += to64((final.charCodeAt(3) << 16) | (final.charCodeAt(9) << 8) | final.charCodeAt(15), 4);
    passwd += to64((final.charCodeAt(4) << 16) | (final.charCodeAt(10) << 8) | final.charCodeAt(5), 4);
    passwd += to64(final.charCodeAt(11), 2);

    return magic + salt + '$' + passwd;
}

function md5(input) {
    return crypto.createHash('md5').update(input, 'binary').digest('binary');
}
