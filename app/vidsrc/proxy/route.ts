import { NextRequest, NextResponse } from "next/server";

const UPSTREAM_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
  Accept: "*/*",
  "Accept-Language": "en-US,en;q=0.8",
  Origin: "https://cloudnestra.com",
  Referer: "https://cloudnestra.com/",
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "cross-site",
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Expose-Headers": "Content-Length,Content-Range",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(req: NextRequest) {
  const targetUrl = new URL(req.url).searchParams.get("url");
  if (!targetUrl)
    return NextResponse.json({ error: "Missing `url`" }, { status: 400 });

  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  try {
    const upstream = await fetch(parsed.toString(), {
      headers: UPSTREAM_HEADERS,
      redirect: "follow",
    });
    if (!upstream.ok)
      return NextResponse.json(
        { error: `Upstream ${upstream.status}` },
        { status: upstream.status },
      );

    const contentType = upstream.headers.get("content-type") ?? "";
    const isPlaylist =
      contentType.includes("mpegurl") ||
      /\.(m3u8)$/.test(targetUrl) ||
      targetUrl.endsWith("master.m3u8") ||
      targetUrl.endsWith("index.m3u8") ||
      targetUrl.endsWith("list.m3u8");

    if (isPlaylist) {
      const proxyBase = `${req.nextUrl.origin}${req.nextUrl.pathname}?url=`;
      const rewritten = rewriteM3u8(await upstream.text(), parsed, proxyBase);
      return new NextResponse(rewritten, {
        headers: {
          ...CORS,
          "Content-Type": "application/vnd.apple.mpegurl",
          "Cache-Control": "no-cache",
        },
      });
    }

    return new NextResponse(await upstream.arrayBuffer(), {
      headers: {
        ...CORS,
        "Content-Type": contentType || "video/MP2T",
        "Cache-Control": upstream.headers.get("cache-control") ?? "no-cache",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

function rewriteM3u8(text: string, parsed: URL, proxyBase: string): string {
  const resolve = (url: string) => {
    if (url.startsWith("http")) return url;
    if (url.startsWith("/")) return `${parsed.origin}${url}`;
    try {
      return new URL(url, parsed.toString()).toString();
    } catch {
      return url;
    }
  };

  return text
    .split("\n")
    .map((line) => {
      const t = line.trim();
      if (!t) return line;
      if (t.startsWith("#") && t.includes('URI="'))
        return t.replace(
          /URI="([^"]+)"/g,
          (_, uri) => `URI="${proxyBase}${encodeURIComponent(resolve(uri))}"`,
        );
      if (t.startsWith("#")) return line;
      return `${proxyBase}${encodeURIComponent(resolve(t))}`;
    })
    .join("\n");
}
