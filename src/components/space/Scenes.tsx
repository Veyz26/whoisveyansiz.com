"use client";

import { useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Float, Line, Sparkles, Html } from "@react-three/drei";
import * as THREE from "three";
import { cvData } from "@/data/cv";

// ───────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────

/** Random points filling a spherical shell of given radius/thickness. */
function shellPoints(count: number, radius: number, thickness: number): Float32Array {
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const u = Math.random();
    const v = Math.random();
    const theta = u * Math.PI * 2;
    const phi = Math.acos(2 * v - 1);
    const r = radius + (Math.random() - 0.5) * thickness;
    arr[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    arr[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    arr[i * 3 + 2] = r * Math.cos(phi);
  }
  return arr;
}

/** Flattened disc of points (a nebula slab) with soft falloff. */
function discPoints(count: number, radius: number, flatten: number): Float32Array {
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const t = Math.random() * Math.PI * 2;
    const r = Math.pow(Math.random(), 0.6) * radius;
    arr[i * 3] = Math.cos(t) * r;
    arr[i * 3 + 1] = (Math.random() - 0.5) * radius * flatten;
    arr[i * 3 + 2] = Math.sin(t) * r;
  }
  return arr;
}

type CloudProps = {
  positions: Float32Array;
  color: string;
  size: number;
  opacity: number;
};

function Cloud({ positions, color, size, opacity }: CloudProps) {
  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={size}
        color={color}
        transparent
        opacity={opacity}
        sizeAttenuation
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

// ───────────────────────────────────────────────────────────────────
// 00 — Hero / Launch
// ───────────────────────────────────────────────────────────────────

export function HeroScene() {
  const core = useRef<THREE.Mesh>(null);
  const halo = useRef<THREE.Points>(null);
  const ring = useRef<THREE.Mesh>(null);
  const halo1 = useMemo(() => shellPoints(1400, 4.2, 1.4), []);

  useFrame((_, delta) => {
    if (core.current) {
      core.current.rotation.y += delta * 0.25;
      core.current.rotation.x += delta * 0.12;
    }
    if (halo.current) halo.current.rotation.y -= delta * 0.06;
    if (ring.current) ring.current.rotation.z += delta * 0.2;
  });

  return (
    <group>
      <mesh ref={core}>
        <icosahedronGeometry args={[2.1, 1]} />
        <meshStandardMaterial
          color="#4f46e5"
          emissive="#6366f1"
          emissiveIntensity={1.6}
          wireframe
        />
      </mesh>
      <mesh>
        <icosahedronGeometry args={[1.25, 0]} />
        <meshStandardMaterial color="#c7d2fe" emissive="#818cf8" emissiveIntensity={1.4} />
      </mesh>
      <mesh ref={ring} rotation={[Math.PI / 2.4, 0, 0]}>
        <torusGeometry args={[3.4, 0.02, 16, 120]} />
        <meshStandardMaterial color="#818cf8" emissive="#818cf8" emissiveIntensity={2} transparent opacity={0.6} />
      </mesh>
      <points ref={halo}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[halo1, 3]} />
        </bufferGeometry>
        <pointsMaterial
          size={0.05}
          color="#a5b4fc"
          transparent
          opacity={0.9}
          sizeAttenuation
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
      <Sparkles count={60} scale={12} size={2} speed={0.3} color="#c7d2fe" opacity={0.7} />
    </group>
  );
}

// ───────────────────────────────────────────────────────────────────
// 01 — About / Nebula
// ───────────────────────────────────────────────────────────────────

export function NebulaScene() {
  const grp = useRef<THREE.Group>(null);
  const core = useRef<THREE.Mesh>(null);
  const purple = useMemo(() => discPoints(2600, 9, 0.5), []);
  const blue = useMemo(() => discPoints(1800, 7, 0.7), []);
  const pink = useMemo(() => discPoints(1200, 5.5, 0.9), []);

  useFrame((_, delta) => {
    if (grp.current) grp.current.rotation.y += delta * 0.05;
    if (core.current) {
      const s = 1 + Math.sin(performance.now() * 0.0008) * 0.06;
      core.current.scale.setScalar(s);
    }
  });

  return (
    <group ref={grp} rotation={[0.5, 0, 0.2]}>
      <Cloud positions={purple} color="#a855f7" size={0.16} opacity={0.5} />
      <Cloud positions={blue} color="#6366f1" size={0.13} opacity={0.45} />
      <Cloud positions={pink} color="#ec4899" size={0.12} opacity={0.4} />
      <mesh ref={core}>
        <sphereGeometry args={[1.1, 32, 32]} />
        <meshStandardMaterial color="#f5d0fe" emissive="#c084fc" emissiveIntensity={2.4} />
      </mesh>
      <Sparkles count={50} scale={16} size={3} speed={0.2} color="#e9d5ff" opacity={0.6} />
    </group>
  );
}

// ───────────────────────────────────────────────────────────────────
// 02 — Experience / Asteroid Belt
// ───────────────────────────────────────────────────────────────────

export function AsteroidBelt() {
  const belt = useRef<THREE.Group>(null);
  const jobs = cvData.experience;
  const [hovered, setHovered] = useState<number | null>(null);

  const asteroids = useMemo(() => {
    return jobs.map((_, i) => {
      const angle = (i / jobs.length) * Math.PI * 2;
      const radius = 6.5;
      const current = i === 0;
      return {
        position: [
          Math.cos(angle) * radius,
          (Math.random() - 0.5) * 1.6,
          Math.sin(angle) * radius,
        ] as [number, number, number],
        scale: current ? 1.5 : 0.8 + Math.random() * 0.5,
        detail: Math.floor(Math.random() * 2),
        spin: 0.2 + Math.random() * 0.4,
        current,
      };
    });
  }, [jobs]);

  useFrame((_, delta) => {
    // Pause the orbit while a visitor is inspecting an asteroid.
    if (belt.current && hovered === null) belt.current.rotation.y += delta * 0.08;
  });

  const enter = (i: number) => {
    setHovered(i);
    document.body.style.cursor = "pointer";
  };
  const leave = () => {
    setHovered(null);
    document.body.style.cursor = "auto";
  };

  return (
    <group ref={belt} rotation={[0.35, 0, 0]}>
      {/* faint orbital guide ring */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[6.5, 0.015, 12, 160]} />
        <meshStandardMaterial color="#38bdf8" emissive="#38bdf8" emissiveIntensity={1} transparent opacity={0.25} />
      </mesh>
      {asteroids.map((a, i) => {
        const job = jobs[i];
        const isHovered = hovered === i;
        const lit = a.current || isHovered;
        return (
          <Float key={i} speed={1.5} rotationIntensity={a.spin} floatIntensity={0.6}>
            <mesh
              position={a.position}
              scale={isHovered ? a.scale * 1.55 : a.scale}
              onPointerOver={(e) => {
                e.stopPropagation();
                enter(i);
              }}
              onPointerOut={(e) => {
                e.stopPropagation();
                leave();
              }}
            >
              <icosahedronGeometry args={[1, a.detail]} />
              <meshStandardMaterial
                color={lit ? "#bae6fd" : "#475569"}
                emissive={lit ? "#38bdf8" : "#0ea5e9"}
                emissiveIntensity={isHovered ? 2.6 : a.current ? 1.8 : 0.4}
                flatShading
                roughness={0.7}
                metalness={0.3}
              />
              {isHovered && (
                <Html
                  center
                  distanceFactor={13}
                  position={[0, 1.5, 0]}
                  zIndexRange={[50, 0]}
                  style={{ pointerEvents: "none" }}
                >
                  <div
                    style={{
                      whiteSpace: "nowrap",
                      transform: "translateY(-50%)",
                      background: "rgba(3,8,20,0.85)",
                      border: "1px solid rgba(56,189,248,0.35)",
                      borderRadius: 12,
                      padding: "8px 12px",
                      boxShadow: "0 8px 30px rgba(0,0,0,0.5)",
                      backdropFilter: "blur(6px)",
                      fontFamily: "var(--font-sans), sans-serif",
                    }}
                  >
                    <div style={{ color: "#fff", fontSize: 13, fontWeight: 600 }}>
                      {job.title}
                    </div>
                    <div style={{ color: "#7dd3fc", fontSize: 11 }}>
                      {job.company} · {job.period}
                    </div>
                  </div>
                </Html>
              )}
            </mesh>
          </Float>
        );
      })}
      <Sparkles count={40} scale={16} size={2} speed={0.25} color="#7dd3fc" opacity={0.5} />
    </group>
  );
}

// ───────────────────────────────────────────────────────────────────
// 03 — Skills / Constellation
// ───────────────────────────────────────────────────────────────────

export function Constellation() {
  const grp = useRef<THREE.Group>(null);

  const { nodes, links } = useMemo(() => {
    const categories = Object.keys(cvData.skills.technical);
    const nodes: THREE.Vector3[] = [];
    const links: [THREE.Vector3, THREE.Vector3][] = [];
    const clusterCenters: THREE.Vector3[] = [];

    categories.forEach((_, ci) => {
      const phi = Math.acos(1 - (2 * (ci + 0.5)) / categories.length);
      const theta = Math.PI * (1 + Math.sqrt(5)) * ci;
      const R = 5.5;
      const center = new THREE.Vector3(
        R * Math.sin(phi) * Math.cos(theta),
        R * Math.cos(phi),
        R * Math.sin(phi) * Math.sin(theta)
      );
      clusterCenters.push(center);

      const localCount = 4;
      const local: THREE.Vector3[] = [];
      for (let n = 0; n < localCount; n++) {
        const offset = new THREE.Vector3(
          (Math.random() - 0.5) * 3,
          (Math.random() - 0.5) * 3,
          (Math.random() - 0.5) * 3
        );
        const p = center.clone().add(offset);
        local.push(p);
        nodes.push(p);
      }
      // connect cluster nodes in a small web
      for (let n = 0; n < local.length; n++) {
        links.push([center, local[n]]);
        if (n > 0) links.push([local[n - 1], local[n]]);
      }
      nodes.push(center);
    });

    // connect cluster centers into a loose backbone
    for (let i = 1; i < clusterCenters.length; i++) {
      links.push([clusterCenters[i - 1], clusterCenters[i]]);
    }

    return { nodes, links };
  }, []);

  useFrame((_, delta) => {
    if (grp.current) {
      grp.current.rotation.y += delta * 0.06;
      grp.current.rotation.x += delta * 0.02;
    }
  });

  return (
    <group ref={grp}>
      {links.map((l, i) => (
        <Line
          key={i}
          points={[l[0], l[1]]}
          color="#34d399"
          lineWidth={0.6}
          transparent
          opacity={0.35}
        />
      ))}
      {nodes.map((p, i) => (
        <mesh key={i} position={p}>
          <sphereGeometry args={[0.12, 12, 12]} />
          <meshStandardMaterial color="#a7f3d0" emissive="#34d399" emissiveIntensity={2.2} />
        </mesh>
      ))}
      <Sparkles count={50} scale={14} size={2} speed={0.2} color="#6ee7b7" opacity={0.5} />
    </group>
  );
}

// ───────────────────────────────────────────────────────────────────
// 04 — Education / Orbiting Moons
// ───────────────────────────────────────────────────────────────────

export function CertMoons() {
  const planet = useRef<THREE.Mesh>(null);
  const moonCount = cvData.education.length;

  const moons = useMemo(() => {
    return Array.from({ length: moonCount }).map((_, i) => ({
      radius: 3 + i * 0.7,
      speed: 0.5 - i * 0.04,
      size: 0.18 + Math.random() * 0.16,
      tilt: (Math.random() - 0.5) * 1.2,
      phase: Math.random() * Math.PI * 2,
    }));
  }, [moonCount]);

  const refs = useRef<(THREE.Group | null)[]>([]);

  useFrame((_, delta) => {
    if (planet.current) planet.current.rotation.y += delta * 0.15;
    moons.forEach((m, i) => {
      const g = refs.current[i];
      if (g) g.rotation.y += delta * m.speed;
    });
  });

  return (
    <group>
      <mesh ref={planet}>
        <icosahedronGeometry args={[1.8, 1]} />
        <meshStandardMaterial
          color="#fb923c"
          emissive="#f97316"
          emissiveIntensity={1.4}
          flatShading
          roughness={0.5}
        />
      </mesh>
      {moons.map((m, i) => (
        <group
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          rotation={[m.tilt, m.phase, 0]}
        >
          {/* orbit guide */}
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[m.radius, 0.008, 8, 120]} />
            <meshStandardMaterial color="#fdba74" emissive="#fdba74" emissiveIntensity={0.8} transparent opacity={0.2} />
          </mesh>
          <mesh position={[m.radius, 0, 0]}>
            <sphereGeometry args={[m.size, 16, 16]} />
            <meshStandardMaterial color="#fed7aa" emissive="#fb923c" emissiveIntensity={1.8} />
          </mesh>
        </group>
      ))}
      <Sparkles count={40} scale={14} size={2} speed={0.2} color="#fed7aa" opacity={0.5} />
    </group>
  );
}

// ───────────────────────────────────────────────────────────────────
// 05 — Contact / Space Station
// ───────────────────────────────────────────────────────────────────

export function StationScene() {
  const grp = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const ring2 = useRef<THREE.Mesh>(null);

  const arms = useMemo(() => [0, 1, 2, 3].map((i) => (i / 4) * Math.PI * 2), []);

  useFrame((_, delta) => {
    if (grp.current) grp.current.rotation.y += delta * 0.12;
    if (ring.current) ring.current.rotation.z += delta * 0.3;
    if (ring2.current) ring2.current.rotation.z -= delta * 0.2;
  });

  return (
    <group ref={grp} rotation={[0.3, 0, 0]}>
      <mesh>
        <icosahedronGeometry args={[1.2, 0]} />
        <meshStandardMaterial color="#fbcfe8" emissive="#f472b6" emissiveIntensity={2} flatShading />
      </mesh>
      <mesh ref={ring} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[2.6, 0.08, 16, 100]} />
        <meshStandardMaterial color="#f472b6" emissive="#ec4899" emissiveIntensity={1.6} metalness={0.6} roughness={0.3} />
      </mesh>
      <mesh ref={ring2} rotation={[Math.PI / 2, 0.6, 0]}>
        <torusGeometry args={[3.6, 0.04, 16, 100]} />
        <meshStandardMaterial color="#c084fc" emissive="#a855f7" emissiveIntensity={1.4} transparent opacity={0.7} />
      </mesh>
      {arms.map((a, i) => (
        <mesh key={i} position={[Math.cos(a) * 2.6, 0, Math.sin(a) * 2.6]} rotation={[0, -a, 0]}>
          <boxGeometry args={[0.9, 0.25, 0.25]} />
          <meshStandardMaterial color="#f9a8d4" emissive="#f472b6" emissiveIntensity={1.2} metalness={0.7} roughness={0.3} />
        </mesh>
      ))}
      <Sparkles count={60} scale={14} size={2.5} speed={0.4} color="#fbcfe8" opacity={0.7} />
    </group>
  );
}
