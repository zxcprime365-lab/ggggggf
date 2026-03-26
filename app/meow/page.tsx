"use client";

import { useState, useEffect, useRef } from "react";
import Hls from "hls.js";

interface ApiResponse {
  step3?: {
    mediaSrcs: string[];
    testDoms?: string[];
    forcedDom?: string;
  };
  error?: string;
}

function HLSPlayer({ src }: { src: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    if (Hls.isSupported()) {
      const hls = new Hls();
      hls.loadSource(`/vidsrc/proxy?url=${src}`);
      hls.attachMedia(video);
      return () => hls.destroy();
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
    }
  }, [src]);

  return (
    <video
      ref={videoRef}
      controls
      autoPlay
      className="w-full rounded-lg bg-black aspect-video"
    />
  );
}

export default function Page() {
  const [id, setId] = useState("238");
  const [dom, setDom] = useState("0");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [src, setSrc] = useState<string | null>(null);

  const doFetch = async () => {
    if (!id.trim()) return;
    setLoading(true);
    setError(null);
    setSrc(null);
    try {
      const res = await fetch(`/vidsrc?id=${id.trim()}&dom=${dom}`);
      const json: ApiResponse = await res.json();
      if (json.error) throw new Error(json.error);
      const first = json.step3?.mediaSrcs?.[0] ?? null;
      if (!first) throw new Error("No media sources found");
      setSrc(first);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">VidSrc Player</h1>

        {/* Controls */}
        <div className="flex gap-3 items-end flex-wrap">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-400">TMDB ID</label>
            <input
              className="bg-zinc-900 border border-zinc-700 rounded-md px-3 py-2 text-sm outline-none focus:border-zinc-400 w-32"
              value={id}
              onChange={(e) => setId(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && doFetch()}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-400">Dom</label>
            <input
              type="number"
              min={0}
              max={9}
              className="bg-zinc-900 border border-zinc-700 rounded-md px-3 py-2 text-sm outline-none focus:border-zinc-400 w-20"
              value={dom}
              onChange={(e) => setDom(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && doFetch()}
            />
          </div>
          <button
            onClick={doFetch}
            disabled={loading}
            className="bg-white text-black font-semibold text-sm px-5 py-2 rounded-md hover:bg-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? "Loading…" : "Fetch"}
          </button>
        </div>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        {src && (
          <div className="space-y-2">
            <HLSPlayer src={src} />
            <p className="text-xs text-zinc-500 truncate">{src}</p>
          </div>
        )}
      </div>
    </div>
  );
}
