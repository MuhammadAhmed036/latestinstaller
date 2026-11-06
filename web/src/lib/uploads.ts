import fs from "node:fs";
import path from "node:path";
import { PACKAGES_DIR } from "./config";
import { ARCHIVE_RE } from "./packages";

/** Chunks stay under 10 MB so no proxy body limit can ever get in the way. */
export const CHUNK_MAX = 10 * 1024 * 1024;
export const MAX_TOTAL = 64 * 1024 ** 3;

const SAFE = /^[A-Za-z0-9][A-Za-z0-9._+()@ -]{0,198}$/;
const CHECKSUM = /\.(sha256|sha256sum|sha512|sha)$/i;

/** Uploads land here first, so a half-sent file is never mistaken for a bundle. */
export const PART_DIR = path.join(PACKAGES_DIR, ".uploads");

export function nameError(name: string | null): string | null {
  if (!name || name !== path.basename(name) || !SAFE.test(name)) return "Invalid file name (letters, digits and . _ + ( ) @ - space only)";
  if (!ARCHIVE_RE.test(name) && !CHECKSUM.test(name)) return "Only .tar / .tar.gz / .tgz bundles and .sha256 checksum files can be uploaded";
  return null;
}

export const finalPath = (name: string) => path.join(PACKAGES_DIR, name);
export const partPath = (name: string) => path.join(PART_DIR, `${name}.part`);

export function sizeOf(p: string): number {
  try {
    const st = fs.statSync(/*turbopackIgnore: true*/ p);
    return st.isFile() ? st.size : -1;
  } catch {
    return -1;
  }
}

export function freeBytes(): number {
  try {
    const s = fs.statfsSync(/*turbopackIgnore: true*/ PACKAGES_DIR);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}
