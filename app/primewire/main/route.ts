import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const slug = searchParams.get("slug");
  const year = searchParams.get("year");

  if (!slug) {
    return json({ error: "Missing required param: slug" }, 400);
  }

  // ─── Step 1: Get PrimeWire ID ──────────────────────────────────────────────
  let primewireId: string;
  try {
    const step1 = await fetch(
      `http://localhost:3000/primewire/1?slug=${slug}&year=${year ?? ""}`,
      { cache: "no-store" },
    );
    const step1Data = await step1.json();

    if (!step1Data.primewireId) {
      return json(
        {
          error: "Step 1 failed: could not find primewireId",
          detail: step1Data,
        },
        502,
      );
    }

    primewireId = step1Data.primewireId;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return json({ error: `Step 1 error: ${message}` }, 500);
  }

  // ─── Step 2: Get Streamtape key ────────────────────────────────────────────
  let streamtapeKey: string;
  try {
    const step2 = await fetch(
      `https://primewire.mov/api/v1/s?s_id=${primewireId}&type=movie`,
      { headers: browserHeaders(), cache: "no-store" },
    );
    const step2Data = await step2.json();

    const servers: { name: string; key: string }[] = step2Data.servers ?? [];
    const streamtape = servers.find(
      (s) => s.name.toLowerCase() === "streamtape",
    );

    if (!streamtape) {
      return json(
        { error: "Step 2 failed: no Streamtape server found", servers },
        404,
      );
    }

    streamtapeKey = streamtape.key;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return json({ error: `Step 2 error: ${message}` }, 500);
  }

  // ─── Step 3: Get stream link ───────────────────────────────────────────────
  try {
    const step3 = await fetch(
      `http://localhost:3000/primewire/3?key=${streamtapeKey}`,
      { cache: "no-store" },
    );
    const step3Data = await step3.json();

    if (!step3Data.link) {
      return json(
        { error: "Step 3 failed: no link returned", detail: step3Data },
        502,
      );
    }

    return json({
      slug,
      year: year ?? null,
      primewireId,

      link: step3Data.link,
      host: step3Data.host,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return json({ error: `Step 3 error: ${message}` }, 500);
  }
}

function browserHeaders(): Record<string, string> {
  return {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    Accept: "application/json",
    Referer: "https://primewire.mov/",
  };
}

function json(data: object, status: number = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Access-Control-Allow-Origin": "*" },
  });
}
