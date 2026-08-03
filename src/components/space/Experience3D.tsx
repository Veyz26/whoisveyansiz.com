"use client";

import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { ScrollControls, Scroll } from "@react-three/drei";
import { EffectComposer, Bloom, Vignette } from "@react-three/postprocessing";
import * as THREE from "three";

import { CameraRig } from "./CameraRig";
import { Starfield } from "./Starfield";
import { Overlay } from "./Overlay";
import { anchorZ, PAGES } from "./constants";
import {
  HeroScene,
  NebulaScene,
  AsteroidBelt,
  Constellation,
  CertMoons,
  StationScene,
} from "./Scenes";

// A point light pinned to the camera so whichever section you're flying
// through is lit, while everything else stays in shadow until you reach it.
function CameraLight() {
  const ref = useRef<THREE.PointLight>(null);
  const { camera } = useThree();
  useFrame(() => {
    if (ref.current) ref.current.position.copy(camera.position);
  });
  return <pointLight ref={ref} intensity={45} distance={55} decay={2} color="#dbeafe" />;
}

export function Experience3D({
  mobile = false,
  entered = false,
}: {
  mobile?: boolean;
  entered?: boolean;
}) {
  return (
    <>
      <color attach="background" args={["#03020d"]} />
      <fog attach="fog" args={["#03020d", 22, 95]} />

      <ambientLight intensity={0.85} />
      <CameraLight />

      <ScrollControls pages={PAGES} damping={0.3}>
        <CameraRig />
        <Starfield mobile={mobile} />

        <group position={[0, 0, anchorZ(0)]}>
          <HeroScene />
        </group>
        <group position={[0, 0, anchorZ(1)]}>
          <NebulaScene />
        </group>
        <group position={[0, 0, anchorZ(2)]}>
          <AsteroidBelt />
        </group>
        <group position={[0, 0, anchorZ(3)]}>
          <Constellation />
        </group>
        <group position={[0, 0, anchorZ(4)]}>
          <CertMoons />
        </group>
        <group position={[0, 0, anchorZ(5)]}>
          <StationScene />
        </group>

        {/* Text overlay is hidden until the visitor enters, so the cover
            screen shows only the 3D sky (no duplicated hero text behind it). */}
        {entered && (
          <Scroll html style={{ width: "100%" }}>
            <Overlay />
          </Scroll>
        )}
      </ScrollControls>

      <EffectComposer>
        <Bloom
          mipmapBlur
          intensity={mobile ? 0.85 : 1.15}
          luminanceThreshold={0.15}
          luminanceSmoothing={0.3}
          radius={mobile ? 0.6 : 0.75}
        />
        <Vignette offset={0.25} darkness={0.7} eskil={false} />
      </EffectComposer>
    </>
  );
}
