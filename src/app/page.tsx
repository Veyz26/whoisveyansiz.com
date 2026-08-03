"use client";

import dynamic from "next/dynamic";

// The 3D experience is browser-only (WebGL), so it must load client-side.
const SpaceExperience = dynamic(
  () => import("@/components/space/SpaceExperience"),
  {
    ssr: false,
    loading: () => (
      <div className="fixed inset-0 flex flex-col items-center justify-center bg-[#03020d]">
        <div className="mb-6 h-12 w-12 animate-spin rounded-full border-2 border-white/15 border-t-indigo-400" />
        <p className="bg-gradient-to-r from-white to-indigo-300 bg-clip-text text-2xl font-bold tracking-tight text-transparent">
          Veyansiz Chetty
        </p>
        <p className="mt-2 text-xs uppercase tracking-[0.3em] text-white/40">
          Loading experience
        </p>
      </div>
    ),
  }
);

export default function Home() {
  return <SpaceExperience />;
}
