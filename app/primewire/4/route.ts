// app/api/stream/route.ts
// Usage: GET /api/stream?url=https://streamtape.com/e/XJPA3KYAy7uDVJk/
//
// Returns the direct video URL — no proxying, zero bandwidth cost on your server.
// The client plays it directly from streamta.site/tpead.net.

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs"; // NOT "edge" — must be Node so both fetches use same IP

export async function GET(request: NextRequest) {
  const embedUrl = request.nextUrl.searchParams.get("url");

  if (!embedUrl) {
    return NextResponse.json(
      {
        error: "Missing 'url' param",
        example: "/api/stream?url=https://streamtape.com/e/XJPA3KYAy7uDVJk/",
      },
      { status: 400 },
    );
  }

  let parsedEmbed: URL;
  try {
    parsedEmbed = new URL(embedUrl);
  } catch {
    return NextResponse.json({ error: "Invalid embed URL" }, { status: 400 });
  }

  // ── Step 1: Fetch embed page ───────────────────────────────────────────────
  let html: string;
  try {
    const embedHeaders = browserHeaders(
      "document",
      "navigate",
      "none",
      parsedEmbed.hostname,
    );
    // Remove Accept-Encoding so the server returns plain text instead of
    // compressed binary that Node's fetch won't auto-decompress.
    delete embedHeaders["Accept-Encoding"];

    const res = await fetch(parsedEmbed.toString(), {
      headers: embedHeaders,
      redirect: "follow",
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `Embed page returned HTTP ${res.status}` },
        { status: 502 },
      );
    }
    html = await res.text();
  } catch (err: any) {
    return NextResponse.json(
      { error: "Failed to fetch embed page", detail: err.message },
      { status: 502 },
    );
  }

  // ── Step 2: Extract real video URL (simulate JS rewrites) ─────────────────
  let videoUrl = extractBotlinkUrl(html);

  if (!videoUrl) {
    return NextResponse.json(
      {
        error: "Could not extract video URL",
        html_snippet: html.slice(0, 1200),
      },
      { status: 404 },
    );
  }

  if (!videoUrl.includes("stream=")) {
    videoUrl += "&stream=1";
  }

  console.log("[stream] video URL:", videoUrl);

  // ── Step 3: Return the URL — client fetches video directly ────────────────
  // No proxying = no bandwidth cost on your server.
  // The ip= token was locked to THIS server's IP in Step 1, but the token
  // itself is now valid and the client can use it directly from their browser.
  return NextResponse.json({ videoUrl });
}

// ── Simulate the page JS botlink rewrite ──────────────────────────────────────
// The raw HTML has a fake token. The real token is in the last JS rewrite block:
//   getElementById('botlink').innerHTML = '//tpead.' + ('xyzanet/...token=REAL').substring(4)
// We find ALL such assignments and take the LAST one, then replay substring() calls.
function extractBotlinkUrl(html: string): string | null {
  const pattern =
    /getElementById\(\s*['"]botlink['"]\s*\)\s*\.innerHTML\s*=\s*['"]([^'"]+)['"]\s*\+\s*\(\s*['"]([^'"]+)['"]\s*\)((?:\s*\.substring\s*\(\s*\d+\s*\))+)/g;

  let lastMatch: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(html)) !== null) {
    lastMatch = m;
  }

  if (lastMatch) {
    const prefix = lastMatch[1];
    const obf = lastMatch[2];
    const calls = lastMatch[3];

    let result = obf;
    for (const [, n] of [...calls.matchAll(/\.substring\s*\(\s*(\d+)\s*\)/g)]) {
      result = result.substring(parseInt(n, 10));
    }

    const full = prefix + result;
    if (full.startsWith("//")) return `https:${full}`;
    if (full.startsWith("http")) return full;
    return `https:/${full}`;
  }

  // Fallback: raw element (wrong token suffix, last resort)
  for (const id of ["botlink", "ideoolink", "robotlink"]) {
    const rx = new RegExp(
      `<(?:div|span)[^>]+id=["']${id}["'][^>]*>([^<]+)<`,
      "i",
    );
    const match = html.match(rx);
    if (match) {
      const raw = match[1].trim();
      if (!raw) continue;
      if (raw.startsWith("http")) return raw;
      if (raw.startsWith("//")) return `https:${raw}`;
      return `https:/${raw}`;
    }
  }

  return null;
}

// ── Browser-spoof headers ─────────────────────────────────────────────────────
function browserHeaders(
  dest: string,
  mode: string,
  site: string,
  hostname: string,
): { [key: string]: string } {
  return {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.6",
    "Accept-Encoding": "gzip, deflate, br, zstd",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    Referer: `https://${hostname}/`,
    Origin: `https://${hostname}`,
    "Sec-Fetch-Dest": dest,
    "Sec-Fetch-Mode": mode,
    "Sec-Fetch-Site": site,
    "Sec-Fetch-User": "?1",
    "Sec-CH-UA": '"Chromium";v="146", "Not-A.Brand";v="24", "Brave";v="146"',
    "Sec-CH-UA-Mobile": "?0",
    "Sec-CH-UA-Platform": '"Windows"',
    "Sec-GPC": "1",
    "Upgrade-Insecure-Requests": "1",
    Priority: "u=0, i",
  };
}
