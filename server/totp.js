import crypto from "node:crypto";

// TOTP (RFC 6238): 30-second steps, 6 digits, HMAC-SHA1 – what authenticator apps expect.
const STEP = 30;
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function newSecret() {
  const bytes = crypto.randomBytes(20);
  let bits = "", out = "";
  for (const b of bytes) bits += b.toString(2).padStart(8, "0");
  for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

function decode(secret) {
  let bits = "";
  for (const c of secret.replace(/=+$/, "").toUpperCase()) {
    const v = B32.indexOf(c);
    if (v < 0) throw new Error("Ogiltig hemlighet");
    bits += v.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

export function codeAt(secret, step) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac("sha1", decode(secret)).update(msg).digest();
  const o = h[h.length - 1] & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, "0");
}

export const currentStep = (now = Date.now()) => Math.floor(now / 1000 / STEP);

// Returns the matching step (±1 step for clock drift) or null. Steps at or before
// lastStep are rejected so a code cannot be used twice.
export function verifyCode(secret, code, lastStep = null, now = Date.now()) {
  const c = String(code || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return null;
  const s = currentStep(now);
  for (const step of [s - 1, s, s + 1]) {
    if (lastStep != null && step <= lastStep) continue;
    if (crypto.timingSafeEqual(Buffer.from(codeAt(secret, step)), Buffer.from(c))) return step;
  }
  return null;
}

export const otpauthUri = (secret, account, issuer = "Vinkällaren") =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP}`;

// Recovery codes: 10 one-time codes like "k7m2-9xq4", stored only as SHA-256 hashes.
export function newRecoveryCodes(n = 10) {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({ length: n }, () => {
    const b = crypto.randomBytes(8);
    const s = [...b].map(x => alphabet[x % alphabet.length]).join("");
    return `${s.slice(0, 4)}-${s.slice(4)}`;
  });
}
export const hashRecovery = code => crypto.createHash("sha256").update(String(code).toLowerCase().replace(/[^a-z0-9]/g, "")).digest("hex");
