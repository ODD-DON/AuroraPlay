import "server-only";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * File storage for listing photos, receipts, and evidence screenshots.
 * Local mode writes under .data/uploads; production uses a private Supabase Storage bucket.
 * Every upload is validated, re-encoded (which strips EXIF location metadata), and size-limited.
 */

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "image/gif"]);
const LOCAL_ROOT = path.join(process.cwd(), ".data", "uploads");
const BUCKET = "resale-radar";

export interface StoredImage {
  storagePath: string;
  mimeType: string;
  width: number;
  height: number;
  sha256: string;
  phash: string;
  bytes: number;
}

/** 64-bit difference hash as 16 hex characters. Used only as one dedup signal. */
async function differenceHash(buf: Buffer): Promise<string> {
  const sharp = (await import("sharp")).default;
  const px = await sharp(buf).grayscale().resize(9, 8, { fit: "fill" }).raw().toBuffer();
  let bits = "";
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += px[y * 9 + x]! < px[y * 9 + x + 1]! ? "1" : "0";
  let hex = "";
  for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}

export async function storeImage(ownerId: string, file: { type: string; size: number; arrayBuffer(): Promise<ArrayBuffer> }): Promise<StoredImage> {
  if (!ALLOWED.has(file.type)) throw new Error(`Unsupported file type ${file.type || "unknown"}. Upload JPEG, PNG, WebP, or HEIC images.`);
  if (file.size > MAX_UPLOAD_BYTES) throw new Error("Images must be 10 MB or smaller.");
  const sharp = (await import("sharp")).default;
  const input = Buffer.from(await file.arrayBuffer());
  // Re-encode: normalizes orientation, strips metadata (including GPS), bounds dimensions.
  const output = await sharp(input, { failOn: "error" }).rotate().resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  const meta = await sharp(output).metadata();
  const sha256 = crypto.createHash("sha256").update(output).digest("hex");
  const phash = await differenceHash(output);
  const storagePath = `${ownerId}/${crypto.randomUUID()}.jpg`;
  await writeObject(storagePath, output, "image/jpeg");
  return { storagePath, mimeType: "image/jpeg", width: meta.width ?? 0, height: meta.height ?? 0, sha256, phash, bytes: output.length };
}

function supabaseStorage() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}

async function writeObject(storagePath: string, data: Buffer, contentType: string) {
  const sb = supabaseStorage();
  if (sb) {
    const { createClient } = await import("@supabase/supabase-js");
    const client = createClient(sb.url, sb.key, { auth: { persistSession: false } });
    const { error } = await client.storage.from(BUCKET).upload(storagePath, data, { contentType, upsert: false });
    if (error) throw new Error(`Storage upload failed: ${error.message}`);
    return;
  }
  const full = safeLocalPath(storagePath);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, data);
}

export async function readObject(storagePath: string): Promise<Buffer> {
  const sb = supabaseStorage();
  if (sb) {
    const { createClient } = await import("@supabase/supabase-js");
    const client = createClient(sb.url, sb.key, { auth: { persistSession: false } });
    const { data, error } = await client.storage.from(BUCKET).download(storagePath);
    if (error || !data) throw new Error("File not found");
    return Buffer.from(await data.arrayBuffer());
  }
  return fs.readFile(safeLocalPath(storagePath));
}

function safeLocalPath(storagePath: string): string {
  if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/i.test(storagePath)) throw new Error("Invalid storage path");
  const full = path.join(LOCAL_ROOT, storagePath);
  if (!full.startsWith(LOCAL_ROOT + path.sep)) throw new Error("Invalid storage path");
  return full;
}
