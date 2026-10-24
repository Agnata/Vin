import { verifyCode, newSecret, newRecoveryCodes, hashRecovery } from "./totp.js";
import { transaction } from "./db.js";

// Two-step verification state for a user, kept in the users table plus recovery_codes.
export function createTwoFactor(db) {
  const q = {
    get: db.prepare("SELECT id, totp_secret, totp_pending, totp_enabled, totp_last_step FROM users WHERE id = ?"),
    setPending: db.prepare("UPDATE users SET totp_pending = ? WHERE id = ?"),
    enable: db.prepare("UPDATE users SET totp_secret = totp_pending, totp_pending = NULL, totp_enabled = 1, totp_last_step = ? WHERE id = ?"),
    disable: db.prepare("UPDATE users SET totp_secret = NULL, totp_pending = NULL, totp_enabled = 0, totp_last_step = NULL WHERE id = ?"),
    lastStep: db.prepare("UPDATE users SET totp_last_step = ? WHERE id = ?"),
    clearCodes: db.prepare("DELETE FROM recovery_codes WHERE user_id = ?"),
    addCode: db.prepare("INSERT INTO recovery_codes (user_id, code_hash) VALUES (?, ?)"),
    useCode: db.prepare("UPDATE recovery_codes SET used_at = datetime('now') WHERE user_id = ? AND code_hash = ? AND used_at IS NULL"),
    codesLeft: db.prepare("SELECT COUNT(*) AS n FROM recovery_codes WHERE user_id = ? AND used_at IS NULL"),
  };

  function issueCodes(userId) {
    const codes = newRecoveryCodes();
    q.clearCodes.run(userId);
    for (const c of codes) q.addCode.run(userId, hashRecovery(c));
    return codes;
  }

  return {
    status(userId) {
      const u = q.get.get(userId);
      return { enabled: !!u?.totp_enabled, recoveryLeft: u?.totp_enabled ? q.codesLeft.get(userId).n : 0 };
    },
    // Starts setup: a new secret that only takes effect after a correct code.
    begin(userId) {
      const secret = newSecret();
      q.setPending.run(secret, userId);
      return secret;
    },
    // Confirms setup with a code from the app; returns the recovery codes (shown once) or null.
    confirm(userId, code) {
      const u = q.get.get(userId);
      if (!u?.totp_pending) return null;
      const step = verifyCode(u.totp_pending, code);
      if (step == null) return null;
      return transaction(db, () => {
        q.enable.run(step, userId);
        return issueCodes(userId);
      });
    },
    // A code from the app, or an unused recovery code. Returns "totp", "recovery" or null.
    check(userId, code) {
      const u = q.get.get(userId);
      if (!u?.totp_enabled) return null;
      const step = verifyCode(u.totp_secret, code, u.totp_last_step);
      if (step != null) { q.lastStep.run(step, userId); return "totp"; }
      if (/[a-z]/i.test(String(code)) && q.useCode.run(userId, hashRecovery(code)).changes === 1) return "recovery";
      return null;
    },
    newRecoveryCodes(userId) {
      return transaction(db, () => issueCodes(userId));
    },
    disable(userId) {
      transaction(db, () => { q.disable.run(userId); q.clearCodes.run(userId); });
    },
  };
}
