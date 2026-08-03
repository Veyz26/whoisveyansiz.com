"use client";

import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useScroll } from "@react-three/drei";
import * as THREE from "three";
import { TOTAL_TRAVEL } from "./constants";
import { useExperience } from "@/lib/experienceStore";

// Flies the camera along -Z through the section anchors as the user
// scrolls, with a gentle drifting sway so the motion feels piloted
// rather than mechanical. Also pushes scroll progress to the store.

export function CameraRig() {
  const scroll = useScroll();
  const { camera } = useThree();
  const setActive = useExperience((s) => s.setActive);
  const register = useExperience((s) => s.register);

  const desired = useRef(new THREE.Vector3(0, 0, 9));
  const lookTarget = useRef(new THREE.Vector3(0, 0, 0));
  const smoothLook = useRef(new THREE.Vector3(0, 0, 0));

  useFrame((_, delta) => {
    const o = scroll.offset;
    setActive(o);
    if (scroll.el) register(scroll.el);

    // Update the slim progress rail without triggering React renders.
    const bar = document.getElementById("exp-progress-fill");
    if (bar) bar.style.transform = `scaleY(${o})`;

    const anchor = -o * TOTAL_TRAVEL;

    // Camera sits a little in front of (+Z) the current anchor and
    // sways on a slow Lissajous path for a cinematic, floating feel.
    desired.current.set(
      Math.sin(o * Math.PI * 2.0) * 2.4,
      Math.cos(o * Math.PI * 3.0) * 1.3 + 0.4,
      anchor + 9
    );

    // Frame-rate independent smoothing.
    const t = 1 - Math.pow(0.0015, delta);
    camera.position.lerp(desired.current, t);

    lookTarget.current.set(
      Math.sin(o * Math.PI * 2.0) * 0.6,
      Math.cos(o * Math.PI * 3.0) * 0.3,
      anchor - 7
    );
    smoothLook.current.lerp(lookTarget.current, t);
    camera.lookAt(smoothLook.current);
  });

  return null;
}
