// app/api/primewire/route.ts
//
// Usage:
//   GET /api/primewire?key=9f805&cf_clearance=<cookie_value>
//
// Params:
//   key           (required) PrimeWire API key
//   cf_clearance  (required) Cloudflare clearance cookie from your browser
//   ...any other params are forwarded upstream as-is

import { NextRequest, NextResponse } from "next/server";

const UPSTREAM_BASE = "https://primewire.si/api/v1/l";

const BROWSER_HEADERS: Record<string, string> = {
  accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.7",
  "cache-control": "no-cache",
  pragma: "no-cache",
  referer: "https://primewire.si/",
  "sec-ch-ua": '"Chromium";v="146", "Not-A.Brand";v="24", "Brave";v="146"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "same-origin",
  "sec-fetch-user": "?1",
  "sec-gpc": "1",
  "upgrade-insecure-requests": "1",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Handle CORS pre-flight
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  // cloudflared-windows-amd64.exe tunnel run --url http://localhost:3000 my-tunnel
  const key = searchParams.get("key");
  const cfClearance =
    searchParams.get("cf_clearance") ||
    "rMzsBAYWGobQKBWRvNyxiT1ruGhV8kwwAubSLqPIzwM-1774412306-1.2.1.1-K5MsOGYXIXMHV.jL62kD4pzDMCde5XcBbCfER1nCrS7LI7l.kScLuKLx8rg4dTmgLG5LY5qeFelJLUIDQIfG.qU2H6jMfLRgeaowFX51qIG.xADckQtc.SyK9v.cgnPtFWl.cddxevW.HEfma1jmORNofIWrerN5VMVjqnShk2GdlWI0b3Mv1ISo6SKeiENwDqYvVMcdUoBQNz2p5CFT19FsEO1T3I6zYj9oC2SCq84";
  if (!key) {
    return errJson(400, "Missing required param: key");
  }
  if (!cfClearance) {
    return errJson(400, "Missing required param: cf_clearance");
  }

  // Build upstream URL — forward everything except cf_clearance
  const upstream = new URL(UPSTREAM_BASE);
  for (const [k, v] of searchParams.entries()) {
    if (k !== "cf_clearance") upstream.searchParams.set(k, v);
  }

  let res: Response;
  try {
    res = await fetch(upstream.toString(), {
      method: "GET",
      headers: {
        ...BROWSER_HEADERS,
        cookie: `cf_clearance=${cfClearance}`,
      },
      redirect: "follow",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return errJson(502, `Upstream fetch failed: ${message}`);
  }

  // Cloudflare challenge — cookie is stale
  if (res.status === 403 || res.status === 503) {
    const preview = (await res.text()).slice(0, 400);
    return NextResponse.json(
      {
        error: "Cloudflare challenge failed — cf_clearance is likely expired",
        upstream_status: res.status,
        hint: "Grab a fresh cf_clearance cookie from your browser and retry",
        upstream_preview: preview,
      },
      { status: 502, headers: CORS_HEADERS },
    );
  }

  const body = await res.arrayBuffer();
  const contentType = res.headers.get("content-type") ?? "application/json";

  return new NextResponse(body, {
    status: res.status,
    headers: {
      "Content-Type": contentType,
      "x-upstream-status": String(res.status),
      ...CORS_HEADERS,
    },
  });
}

function errJson(status: number, message: string) {
  return NextResponse.json(
    { error: message },
    { status, headers: CORS_HEADERS },
  );
}
