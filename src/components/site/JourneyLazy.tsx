"use client";

import dynamic from "next/dynamic";

// WebGL is browser-only: the page's words render on the server and the journey arrives behind them.
export const JourneyLazy = dynamic(() => import("./Journey").then((m) => m.Journey), { ssr: false, loading: () => null });
