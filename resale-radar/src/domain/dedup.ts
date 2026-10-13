/**
 * Duplicate and relist detection. Several independent signals are required
 * before two listings are linked; image similarity alone never merges records.
 */

export interface ListingFingerprint {
  id: string;
  source: string;
  externalId: string | null;
  canonicalUrl: string | null;
  title: string;
  priceCents: number;
  sellerName: string | null;
  imageHashes: string[];
}

export function canonicalizeUrl(raw: string): { source: string; externalId: string | null; canonicalUrl: string } | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) return null;
  const host = url.hostname.replace(/^(www\.|m\.|web\.)/, "");
  const fb = url.pathname.match(/\/marketplace\/item\/(\d+)/);
  if (host.endsWith("facebook.com") && fb) {
    return { source: "facebook_marketplace", externalId: fb[1]!, canonicalUrl: `https://www.facebook.com/marketplace/item/${fb[1]}/` };
  }
  const ebay = url.pathname.match(/\/itm\/(?:[^/]+\/)?(\d{9,15})/);
  if (/(^|\.)ebay\.[a-z.]+$/.test(host) && ebay) {
    return { source: "ebay", externalId: ebay[1]!, canonicalUrl: `https://www.ebay.com/itm/${ebay[1]}` };
  }
  const cl = url.pathname.match(/\/(\d{8,12})\.html$/);
  if (host.endsWith("craigslist.org") && cl) {
    return { source: "craigslist", externalId: cl[1]!, canonicalUrl: `https://${host}${url.pathname}` };
  }
  const offerup = url.pathname.match(/\/item\/detail\/([\w-]+)/);
  if (host.endsWith("offerup.com") && offerup) {
    return { source: "offerup", externalId: offerup[1]!, canonicalUrl: `https://offerup.com/item/detail/${offerup[1]}` };
  }
  url.hash = "";
  for (const k of [...url.searchParams.keys()]) if (/^(utm_|fbclid|ref|mibextid|_trkparms|hash)/i.test(k)) url.searchParams.delete(k);
  return { source: "other", externalId: null, canonicalUrl: url.toString() };
}

function trigrams(s: string): Set<string> {
  const t = ` ${s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim()} `;
  const out = new Set<string>();
  for (let i = 0; i < t.length - 2; i++) out.add(t.slice(i, i + 3));
  return out;
}

export function titleSimilarity(a: string, b: string): number {
  const A = trigrams(a);
  const B = trigrams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Hamming distance between two equal-length hex perceptual hashes. */
export function hammingHex(a: string, b: string): number {
  if (a.length !== b.length) return Infinity;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16);
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}

export interface DuplicateAssessment {
  isDuplicate: boolean;
  kind: "same_listing" | "relist_or_crosspost" | "possible" | "different";
  signals: string[];
  score: number;
}

export function assessDuplicate(a: ListingFingerprint, b: ListingFingerprint): DuplicateAssessment {
  const signals: string[] = [];
  if (a.source === b.source && a.externalId && a.externalId === b.externalId) {
    return { isDuplicate: true, kind: "same_listing", signals: ["Same marketplace listing id"], score: 1 };
  }
  if (a.canonicalUrl && a.canonicalUrl === b.canonicalUrl) {
    return { isDuplicate: true, kind: "same_listing", signals: ["Same URL"], score: 1 };
  }
  const sim = titleSimilarity(a.title, b.title);
  if (sim >= 0.55) signals.push(`Title similarity ${(sim * 100).toFixed(0)}%`);
  const priceClose = a.priceCents > 0 && Math.abs(a.priceCents - b.priceCents) / Math.max(a.priceCents, b.priceCents) <= 0.15;
  if (priceClose) signals.push("Price within 15%");
  const sameSeller = !!a.sellerName && !!b.sellerName && a.sellerName.trim().toLowerCase() === b.sellerName.trim().toLowerCase();
  if (sameSeller) signals.push("Same seller name");
  let imageMatch = false;
  outer: for (const ha of a.imageHashes) for (const hb of b.imageHashes) if (hammingHex(ha, hb) <= 6) { imageMatch = true; break outer; }
  if (imageMatch) signals.push("Near-identical photo");

  // Image similarity counts only alongside independent text or seller evidence.
  const textual = (sim >= 0.55 ? 1 : 0) + (sameSeller ? 1 : 0);
  const score = (sim >= 0.55 ? 0.35 : 0) + (priceClose ? 0.15 : 0) + (sameSeller ? 0.25 : 0) + (imageMatch ? 0.25 : 0);
  if (textual >= 1 && imageMatch && (priceClose || sameSeller)) return { isDuplicate: true, kind: "relist_or_crosspost", signals, score };
  if (textual >= 2 && priceClose) return { isDuplicate: true, kind: "relist_or_crosspost", signals, score };
  if (score >= 0.5) return { isDuplicate: false, kind: "possible", signals, score };
  return { isDuplicate: false, kind: "different", signals, score };
}
