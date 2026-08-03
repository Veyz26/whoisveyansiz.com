"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Experience3D } from "./Experience3D";
import { SideNav } from "./SideNav";
import { TopBar } from "./TopBar";
import { BackToTop } from "./BackToTop";
import { Cover } from "./Cover";
import { useSpaceAudio } from "@/lib/spaceAudio";

// Top-level client entry for the 3D experience. Owns the fixed full-screen
// Canvas, the DOM chrome (TopBar + SideNav + BackToTop), and the cinematic
// cover/intro screen. Detects small screens once to dial back render cost
// (lower DPR + lighter bloom) on phones.
//
// `--vph` is published to match the canvas container's real pixel height —
// the same value drei's ScrollControls uses to size its scroll pages — so the
// overlay sections stay in lock-step with the camera on mobile (where 100vh is
// taller than the visible area and would otherwise drift sections off-screen).

export default function SpaceExperience() {
  const [ready, setReady] = useState(false);
  const [entered, setEntered] = useState(false);
  const [mobile] = useState(
    () => typeof window !== "undefined" && window.innerWidth < 768
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const { enabled, toggle } = useSpaceAudio();

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const sync = () =>
      document.documentElement.style.setProperty("--vph", `${el.clientHeight}px`);
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    window.addEventListener("resize", sync);
    window.addEventListener("orientationchange", sync);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", sync);
      window.removeEventListener("orientationchange", sync);
    };
  }, []);

  // Entering is the user gesture that lets the soundtrack autoplay.
  const handleEnter = () => {
    if (!enabled) toggle();
    setEntered(true);
  };

  return (
    <div ref={rootRef} className="fixed inset-0 bg-[#03020d]">
      <Canvas
        dpr={[1, mobile ? 1.3 : 1.7]}
        gl={{ antialias: !mobile, powerPreference: "high-performance" }}
        camera={{ fov: 60, near: 0.1, far: 400, position: [0, 0, 9] }}
        onCreated={() => setTimeout(() => setReady(true), 400)}
      >
        <Suspense fallback={null}>
          <Experience3D mobile={mobile} entered={entered} />
        </Suspense>
      </Canvas>

      {entered && (
        <>
          <TopBar />
          <SideNav />
          <BackToTop />
        </>
      )}

      <Cover ready={ready} hidden={entered} onEnter={handleEnter} />
    </div>
  );
}
