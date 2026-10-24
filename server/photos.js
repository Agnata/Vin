import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// Label photos: one per wine, stored as <id>.jpg plus <id>-thumb.jpg in DATA_DIR/photos.
// The browser shrinks the picture before upload, so the server only checks and stores JPEG bytes.
const ID = /^[A-Za-z0-9_-]{16}$/;
export const MAX_FULL = 3 * 1024 * 1024;
export const MAX_THUMB = 300 * 1024;

const isJpeg = buf => buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;

export function createPhotos(dir) {
  const file = (id, size) => path.join(dir, size === "thumb" ? `${id}-thumb.jpg` : `${id}.jpg`);
  return {
    dir,
    // Returns the new photo id, or throws with a message for the user.
    save(full, thumb) {
      if (!isJpeg(full) || !isJpeg(thumb)) throw new Error("Bilden måste vara en JPEG.");
      if (full.length > MAX_FULL || thumb.length > MAX_THUMB) throw new Error("Bilden är för stor.");
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const id = crypto.randomBytes(12).toString("base64url");
      fs.writeFileSync(file(id, "full"), full, { mode: 0o600 });
      fs.writeFileSync(file(id, "thumb"), thumb, { mode: 0o600 });
      return id;
    },
    path(id, size) {
      if (!ID.test(String(id))) return null;
      const p = file(id, size);
      return fs.existsSync(p) ? p : null;
    },
    remove(id) {
      if (!ID.test(String(id))) return;
      for (const size of ["full", "thumb"]) fs.rmSync(file(id, size), { force: true });
    },
  };
}
