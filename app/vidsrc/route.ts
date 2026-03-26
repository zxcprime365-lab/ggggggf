import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

async function fetchHTML(url: string, referer?: string): Promise<string> {
  const res = await fetch(url, {
    headers: { ...HEADERS, ...(referer ? { Referer: referer } : {}) },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
  return res.text();
}

function extractIframes(html: string, base: string): string[] {
  const $ = cheerio.load(html);
  const srcs: string[] = [];
  $("iframe").each((_, el) => {
    const src = $(el).attr("src") || $(el).attr("data-src");
    if (src) srcs.push(new URL(src, base).toString());
  });
  const regex = /iframe[^>]+(?:src|data-src)=["']([^"']+)["']/gi;
  let m;
  while ((m = regex.exec(html)) !== null) {
    const resolved = new URL(m[1], base).toString();
    if (!srcs.includes(resolved)) srcs.push(resolved);
  }
  return srcs;
}

function extractMediaFromHtml(
  html: string,
  domList: string[],
  domIndex: number | null,
): { rawMediaSrcs: string[]; resolvedSrcs: string[] } {
  const forcedDom =
    domIndex !== null && domList[domIndex] ? domList[domIndex] : null;

  const rawMediaSrcs: string[] = [];

  // Named key pattern: file: "...", src: "...", etc.
  const mediaRegex =
    /(?:src|file|source|mediaSrc|url)\s*[:=]\s*["']([^"']*(?:\.m3u8|\.mp4|list\.m3u8|master\.m3u8)[^"']*)["']/gi;
  let m;
  while ((m = mediaRegex.exec(html)) !== null) {
    for (const part of m[1].split(/\s+or\s+/)) {
      const t = part.trim();
      if (t && !rawMediaSrcs.includes(t)) rawMediaSrcs.push(t);
    }
  }

  // Array literal pattern
  const arrayUrlRegex =
    /["'](https?:\/\/[^"']*(?:\.m3u8|list\.m3u8|master\.m3u8)[^"']*)["']/g;
  while ((m = arrayUrlRegex.exec(html)) !== null) {
    for (const part of m[1].split(/\s+or\s+/)) {
      const t = part.trim();
      if (t && !rawMediaSrcs.includes(t)) rawMediaSrcs.push(t);
    }
  }

  function getDomainSuffix(host: string): string {
    const dot = host.indexOf(".");
    return dot !== -1 ? host.slice(dot + 1) : host;
  }

  function resolveDomains(src: string): string[] {
    if (!src.includes("{v")) return [src];
    const tokens = [...new Set(src.match(/\{v\d+\}/g) || [])];
    let result = src;
    for (const token of tokens) {
      const domEntry = forcedDom
        ? forcedDom
        : domList[parseInt(token.replace(/\{v|\}/g, ""), 10) - 1];
      if (!domEntry) continue;
      const fullHost = domEntry.replace(/^https?:\/\//, "");
      const prefixRe = new RegExp(
        `([a-zA-Z0-9_-]+)\\.${token.replace(/[{}]/g, "\\$&")}`,
        "g",
      );
      if (prefixRe.test(result)) {
        result = result.replace(
          new RegExp(
            `([a-zA-Z0-9_-]+)\\.${token.replace(/[{}]/g, "\\$&")}`,
            "g",
          ),
          `$1.${getDomainSuffix(fullHost)}`,
        );
      } else {
        result = result.replaceAll(token, fullHost);
      }
    }
    return result.includes("{v") ? [] : [result];
  }

  return {
    rawMediaSrcs,
    resolvedSrcs: rawMediaSrcs.flatMap(resolveDomains),
  };
}

function extractDomList(html: string): string[] {
  const match = html.match(/var\s+test_doms\s*=\s*(\[[\s\S]*?\]);/);
  if (!match) return [];
  try {
    return JSON.parse(match[1]);
  } catch {
    const out: string[] = [];
    const re = /["'](https?:\/\/[^"']+)["']/g;
    let m;
    while ((m = re.exec(match[1])) !== null) out.push(m[1]);
    return out;
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const domParam = searchParams.get("dom");
  const domIndex = domParam !== null ? parseInt(domParam, 10) : null;

  if (!id) return NextResponse.json({ error: "Missing `id`" }, { status: 400 });

  const url = `https://vidsrcme.ru/embed/movie?tmdb=${id}`;

  try {
    // Step 1 — vidsrcme page → find iframe
    const html1 = await fetchHTML(url, new URL(url).origin);
    const iframes1 = extractIframes(html1, url);
    if (iframes1.length === 0)
      return NextResponse.json({ error: "No iframes found on step 1", url });

    const step2Url = iframes1[0]; // e.g. cloudnestra.com/rcp/...
    const step2Origin = new URL(step2Url).origin;

    // Step 2 — cloudnestra /rcp/ page
    const html2 = await fetchHTML(step2Url, url);

    // Try to find /prorcp/ path
    const proRcpMatches: string[] = [];
    const proRcpRegex = /['"](\/prorcp\/[^'"]+)['"]/g;
    let m2;
    while ((m2 = proRcpRegex.exec(html2)) !== null) {
      const resolved = new URL(m2[1], step2Origin).toString();
      if (!proRcpMatches.includes(resolved)) proRcpMatches.push(resolved);
    }

    const iframes2 = extractIframes(html2, step2Url);
    const allStep2 = Array.from(new Set([...iframes2, ...proRcpMatches]));

    // If /prorcp/ found → step 3 as before
    if (allStep2.length > 0) {
      const step3Url = allStep2[0];
      const html3 = await fetchHTML(step3Url, step2Url);
      const domList = extractDomList(html3);
      const { resolvedSrcs } = extractMediaFromHtml(html3, domList, domIndex);
      return NextResponse.json({ step3: { mediaSrcs: resolvedSrcs } });
    }

    // No /prorcp/ — media is directly in the /rcp/ page (step 2)
    const domList = extractDomList(html2);
    const { resolvedSrcs } = extractMediaFromHtml(html2, domList, domIndex);
    return NextResponse.json({ step3: { mediaSrcs: resolvedSrcs } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
