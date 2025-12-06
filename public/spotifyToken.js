"use strict";

const { webcrypto } = require("node:crypto");
const { TextEncoder } = require("util");

const crypto = webcrypto;
const fetch = globalThis.fetch;

if (!crypto) {
  throw new Error("Web Crypto API is unavailable in this environment");
}

if (typeof fetch !== "function") {
  throw new Error("Global fetch is unavailable; upgrade Node.js to v18+.");
}

const TOKEN_URL = "https://open.spotify.com/api/token";
const SERVER_TIME_URL = "https://open.spotify.com/";
const SECRET_CIPHER_DICT_URL = "https://github.com/xyloflake/spot-secrets-go/blob/main/secrets/secretDict.json?raw=true";

const secretCipherDict = {
  "14": [62, 54, 109, 83, 107, 77, 41, 103, 45, 93, 114, 38, 41, 97, 64, 51, 95, 94, 95, 94],
  "13": [59, 92, 64, 70, 99, 78, 117, 75, 99, 103, 116, 67, 103, 51, 87, 63, 93, 59, 70, 45, 32]
};

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const BASE32_LOOKUP = BASE32_ALPHABET.split("").reduce((acc, char, idx) => {
  acc[char] = idx;
  return acc;
}, {});

function ensureTotpVersion(requestedVer) {
  const available = Object.keys(secretCipherDict).map(Number).sort((a, b) => a - b);
  if (!available.length) {
    throw new Error("Secret cipher dictionary is empty");
  }
  if (requestedVer !== undefined && requestedVer !== null) {
    if (!Number.isInteger(requestedVer)) {
      throw new Error("Invalid totpVersion value");
    }
    if (!secretCipherDict[String(requestedVer)]) {
      throw new Error(`No secret cipher available for version ${requestedVer}`);
    }
    return requestedVer;
  }
  return available[available.length - 1];
}

function xorTransformSecret(cipherBytes) {
  return cipherBytes.map((value, index) => value ^ ((index % 33) + 9));
}

function textToUint8(text) {
  return new TextEncoder().encode(text);
}

function base32Encode(bytes) {
  let output = "";
  let buffer = 0;
  let bitsLeft = 0;

  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bitsLeft += 8;
    while (bitsLeft >= 5) {
      const index = (buffer >> (bitsLeft - 5)) & 0x1f;
      output += BASE32_ALPHABET[index];
      bitsLeft -= 5;
    }
  }

  if (bitsLeft > 0) {
    const index = (buffer << (5 - bitsLeft)) & 0x1f;
    output += BASE32_ALPHABET[index];
  }

  while (output.length % 8 !== 0) {
    output += "=";
  }

  return output;
}

function base32Decode(text) {
  const input = text.toUpperCase().replace(/=+$/g, "");
  let buffer = 0;
  let bitsLeft = 0;
  const bytes = [];

  for (const char of input) {
    if (!(char in BASE32_LOOKUP)) {
      throw new Error(`Invalid base32 character: ${char}`);
    }
    buffer = (buffer << 5) | BASE32_LOOKUP[char];
    bitsLeft += 5;

    if (bitsLeft >= 8) {
      bitsLeft -= 8;
      bytes.push((buffer >> bitsLeft) & 0xff);
    }
  }

  return new Uint8Array(bytes);
}

function deriveTotpSecret(version) {
  const cipherBytes = secretCipherDict[String(version)];
  if (!cipherBytes) {
    throw new Error(`Missing cipher bytes for version ${version}`);
  }
  const transformed = xorTransformSecret(cipherBytes);
  const digits = transformed.map(String).join("");
  const asciiBytes = textToUint8(digits);
  return base32Encode(asciiBytes).replace(/=/g, "");
}

function toHex(bytes) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function randomHex(size) {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

function buildLegacyParams(serverTimestamp, clientTimestamp) {
  const serverDate = new Date(serverTimestamp * 1000);
  const pad = (value) => value.toString().padStart(2, "0");
  const year = serverDate.getUTCFullYear();
  const month = pad(serverDate.getUTCMonth() + 1);
  const day = pad(serverDate.getUTCDate());
  const buildDate = `${year}-${month}-${day}`;
  const buildVer = `web-player_${buildDate}_${serverTimestamp * 1000}_${randomHex(4)}`;

  return {
    sTime: serverTimestamp,
    cTime: clientTimestamp,
    buildDate,
    buildVer
  };
}

async function downloadSecretCipherDict(url) {
  const response = await fetch(url, { cache: "no-store", credentials: "omit" });
  if (!response.ok) {
    throw new Error(`Failed to download secrets: ${response.status}`);
  }

  const payload = await response.json();
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Secret payload is not a dictionary");
  }

  let updated = false;
  for (const [key, value] of Object.entries(payload)) {
    if (!/^\d+$/.test(key)) {
      throw new Error(`Invalid secret key: ${key}`);
    }
    if (!Array.isArray(value) || value.some((entry) => !Number.isInteger(entry))) {
      throw new Error(`Invalid secret value for version ${key}`);
    }
    const existing = secretCipherDict[key];
    const different = !existing || existing.length !== value.length || existing.some((entry, idx) => entry !== value[idx]);
    if (different) {
      secretCipherDict[key] = value.slice();
      updated = true;
    }
  }
  return updated;
}

async function fetchServerTime() {
  const response = await fetch(SERVER_TIME_URL, {
    method: "HEAD",
    cache: "no-store",
    credentials: "include"
  });

  const dateHeader = response.headers.get("date");
  if (!dateHeader) {
    throw new Error("Missing Date header in server response");
  }

  const parsed = new Date(dateHeader);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Unable to parse server time");
  }

  return Math.floor(parsed.getTime() / 1000);
}

async function generateTotp(secret, timestampSeconds) {
  const timeStep = Math.floor(timestampSeconds / 30);
  const counter = new Uint8Array(8);
  let value = timeStep;

  for (let i = 7; i >= 0; i -= 1) {
    counter[i] = value & 0xff;
    value >>= 8;
  }

  const keyData = base32Decode(secret);
  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );

  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, counter));
  const offset = signature[signature.length - 1] & 0x0f;
  const binary =
    ((signature[offset] & 0x7f) << 24) |
    ((signature[offset + 1] & 0xff) << 16) |
    ((signature[offset + 2] & 0xff) << 8) |
    (signature[offset + 3] & 0xff);
  const otp = (binary % 1_000_000).toString().padStart(6, "0");

  return otp;
}

async function requestToken(params) {
  const url = new URL(TOKEN_URL);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, String(value));
  });

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
      "App-Platform": "WebPlayer"
    },
    credentials: "include",
    cache: "no-store"
  });

  const data = await response.json();
  return { ok: response.ok, status: response.status, data };
}

async function checkTokenValidity(accessToken, clientId) {
  if (!accessToken) {
    return false;
  }

  const response = await fetch("https://api.spotify.com/v1/me", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(clientId ? { "Client-Id": clientId } : {})
    },
    credentials: "include"
  });

  if (response.status === 200) {
    return true;
  }

  if (response.status === 401) {
    const payload = await response.json().catch(() => null);
    const message = payload?.error?.message?.toLowerCase?.() || "";
    if (message.includes("valid user authentication required")) {
      return true;
    }
  }

  return false;
}

async function getAccessToken(options = {}) {
  const {
    totpVersion = 61,
    downloadSecrets = true,
    secretDictUrl = SECRET_CIPHER_DICT_URL,
    verifyToken = true
  } = options;

  if (downloadSecrets) {
    try {
      await downloadSecretCipherDict(secretDictUrl);
    } catch (error) {
      console.warn("Failed to refresh secret dictionary:", error);
    }
  }

  const version = ensureTotpVersion(totpVersion);
  const secret = deriveTotpSecret(version);
  const serverTimestamp = await fetchServerTime();
  const otp = await generateTotp(secret, serverTimestamp);
  const clientTimestamp = Math.floor(Date.now());

  const baseParams = {
    reason: "transport",
    productType: "web-player",
    totp: otp,
    totpServer: otp,
    totpVer: version
  };

  if (version < 10) {
    Object.assign(baseParams, buildLegacyParams(serverTimestamp, clientTimestamp));
  }

  let tokenData = await requestToken(baseParams);

  if (!tokenData.ok || !tokenData.data?.accessToken) {
    const initParams = { ...baseParams, reason: "init" };
    tokenData = await requestToken(initParams);
  }

  const accessToken = tokenData.data?.accessToken || "";
  const expiresAt = tokenData.data?.accessTokenExpirationTimestampMs
    ? Math.floor(tokenData.data.accessTokenExpirationTimestampMs / 1000)
    : null;
  const clientId = tokenData.data?.clientId || "";

  const isValid = verifyToken ? await checkTokenValidity(accessToken, clientId) : null;

  if (!accessToken) {
    throw new Error("Unable to fetch access token");
  }

  return {
    accessToken,
    expiresAt,
    clientId,
    isValid
  };
}

async function getRecommendSong(token, trackId) {
  if (!token) {
    throw new Error("Missing Spotify access token");
  }
  if (!trackId) {
    throw new Error("Missing trackId");
  }

  const url = `https://spclient.wg.spotify.com/inspiredby-mix/v2/seed_to_playlist/spotify:track:${trackId}?response-format=json`;

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:145.0) Gecko/20100101 Firefox/145.0",
        authorization: `Bearer ${token}`
      }
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }

    return await res.json();
  } catch (error) {
    console.error("getRecommendSong failed:", error);
    throw error;
  }
}

module.exports = {
  getAccessToken,
  getRecommendSong
};
