import { NextRequest, NextResponse } from "next/server";

interface Card {
  href: string;
  pathSlug: string;
  title: string;
  year: string | null;
  score?: number;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const slug = searchParams.get("slug");
  const year = searchParams.get("year");

  if (!slug) {
    return json({ error: "Missing required param: slug" }, 400);
  }

  const searchQuery = slug.replace(/-/g, " ").trim();

  const dsToken = await computeDs(searchQuery);

  const encodedQuery = encodeURIComponent(searchQuery);
  const searchUrl = `https://primewire.mov/filter?s=${encodedQuery}&ds=${dsToken}`;

  let html: string;
  try {
    const response = await fetch(searchUrl, {
      headers: browserHeaders(),
      redirect: "follow",
    });

    if (!response.ok) {
      return json(
        {
          error: `PrimeWire fetch failed: ${response.status} ${response.statusText}`,
          ds_token: dsToken,
          search_url: searchUrl,
        },
        502,
      );
    }

    html = await response.text();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return json({ error: `Fetch error: ${message}` }, 500);
  }

  const cards = parseCards(html);

  const scored: Card[] = cards
    .map((card) => ({ ...card, score: scoreCard(card, slug, year) }))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  const best = scored[0]?.score && scored[0].score > 0 ? scored[0] : null;

  if (!best) {
    return json({ error: "No match found" }, 404);
  }

  const extractId = (pathSlug: string) => pathSlug.match(/^(\d+)/)?.[1] ?? null;

  return json({
    primewireId: extractId(best.pathSlug),
    query: searchQuery,
    year: year || null,
    ds_token: dsToken,
    full_url: `https://primewire.mov${best.href}`,
  });
}

// ─── ds Token ──────────────────────────────────────────────────────────────────
async function computeDs(query: string): Promise<string> {
  const salt = "JyjId97F9PVqUPuMO0";
  const data = new TextEncoder().encode(query + salt);
  const buffer = await crypto.subtle.digest("SHA-1", data);
  const hex = Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hex.slice(0, 10);
}

// ─── Card Parser ───────────────────────────────────────────────────────────────
function parseCards(html: string): Card[] {
  const cards: Card[] = [];
  const seen = new Set<string>();

  const chunks = html.split(/(?=<div class="index_item)/);
  for (const chunk of chunks) {
    const hrefMatch = chunk.match(
      /href="(\/(?:movie|tv)\/([^"]+))"\s+title="([^"]+)"/,
    );
    if (!hrefMatch) continue;

    const href = hrefMatch[1];
    const pathSlug = hrefMatch[2];
    const rawTitle = hrefMatch[3];

    if (seen.has(href)) continue;
    seen.add(href);

    const yearMatch = rawTitle.match(/\((\d{4})\)\s*$/);
    const cardYear = yearMatch ? yearMatch[1] : null;
    const title = yearMatch
      ? rawTitle
          .replace(/\s*\(\d{4}\)\s*$/, "")
          .replace(/^["']|["']$/g, "")
          .trim()
      : rawTitle.trim();

    cards.push({ href, pathSlug, title, year: cardYear });
  }

  return cards;
}

// ─── Scorer ────────────────────────────────────────────────────────────────────
function scoreCard(card: Card, slug: string, year: string | null): number {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

  const normSlug = normalize(slug);
  const pathNoId = card.pathSlug.replace(/^\d+-/, "");
  const normPath = normalize(pathNoId);
  const normTitle = normalize(card.title);
  const slugWords = slug.toLowerCase().split("-").filter(Boolean);

  let score = 0;

  if (normPath === normSlug) score += 200;
  else if (normPath.startsWith(normSlug)) score += 100;
  else if (normSlug.startsWith(normPath) && normPath.length > 5) score += 70;
  else if (normPath.includes(normSlug)) score += 50;

  const lenDiff = normPath.length - normSlug.length;
  if (lenDiff > 3) score -= lenDiff * 3;

  if (normTitle === normSlug) score += 150;
  else if (normTitle.startsWith(normSlug)) score += 60;
  else if (normTitle.includes(normSlug)) score += 40;

  const titleWords = card.title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/);
  const overlap = slugWords.filter((w: string) =>
    titleWords.includes(w),
  ).length;
  score += Math.round(
    (overlap / Math.max(slugWords.length, titleWords.length)) * 30,
  );

  if (year && card.year) {
    if (card.year === year) score += 100;
    else score -= 60;
  } else if (year && !card.year) {
    score -= 10;
  }

  if (card.href.startsWith("/movie/")) score += 5;

  return score;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
function browserHeaders(): Record<string, string> {
  return {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    Referer: "https://primewire.mov/",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "same-origin",
    "Upgrade-Insecure-Requests": "1",
  };
}

function json(data: object, status: number = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Access-Control-Allow-Origin": "*" },
  });
}
