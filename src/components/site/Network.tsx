"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";

// The systems Veyansiz runs, drawn as a constellation of satellites in orbit around the planet, with laser
// links between neighbours and traffic moving along them. The named satellites are real tools from the CV;
// the rest are the hosts behind them. The planet hides whatever is behind it, names included.
// Colours come from the page (--c-node, ...).

export const SYSTEMS = [
  "Microsoft Azure", "AWS", "VMware", "Red Hat Linux", "Windows Server", "Ansible", "GitLab", "Octopus Deploy",
  "PowerShell", "Kubernetes", "Docker", "Terraform (learning)", "Power BI", "Okta", "Entra ID", "ManageEngine",
  "Azure DevOps", "ServiceNow", "Python",
];
const HOSTS = 50;
const TRAFFIC = 120;

export function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const cssColor = (name: string, fallback: string) =>
  new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback);

function useGraph(radius: number) {
  return useMemo(() => {
    const rand = rng(26);
    const n = SYSTEMS.length + HOSTS;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < n; i++) {
      // Spread evenly over a shell (a Fibonacci sphere), at slightly different altitudes like real orbits.
      const y = 1 - (i / (n - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const th = i * Math.PI * (3 - Math.sqrt(5)) + (rand() - 0.5) * 0.3;
      const k = radius * (0.97 + rand() * 0.08);
      pts.push(new THREE.Vector3(Math.cos(th) * r * k, y * k, Math.sin(th) * r * k));
    }
    // Spread the named systems over the whole shape.
    const order = pts.map((_, i) => i).sort(() => rand() - 0.5);
    const labelled = order.slice(0, SYSTEMS.length);
    const edges: [number, number][] = [];
    const seen = new Set<string>();
    pts.forEach((p, i) => {
      const near = pts.map((q, j) => [j, p.distanceToSquared(q)] as const).filter(([j]) => j !== i).sort((a, b) => a[1] - b[1]).slice(0, 3);
      for (const [j] of near) {
        const key = i < j ? `${i}-${j}` : `${j}-${i}`;
        if (!seen.has(key)) { seen.add(key); edges.push([i, j]); }
      }
    });
    return { pts, labelled, edges };
  }, [radius]);
}

export type Labels = React.RefObject<(HTMLSpanElement | null)[]>;

export function Network({ labels, still, position, radius, planetRadius }: {
  labels: Labels; still: boolean; position: [number, number, number]; radius: number; planetRadius: number;
}) {
  const { pts, labelled, edges } = useGraph(radius);
  const { size, camera } = useThree();
  const group = useRef<THREE.Group>(null);
  const big = useRef<THREE.InstancedMesh>(null);
  const halo = useRef<THREE.InstancedMesh>(null);
  const small = useRef<THREE.InstancedMesh>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const pointer = useRef({ x: 0, y: 0 });
  // On wide screens, names stay to the right of the hero's words: their right edge plus a margin.
  const heroEdge = useRef(0);
  // Where the hero's words are on screen (page coordinates), so no name is ever drawn over them.
  const heroBox = useRef({ left: 0, top: 0, right: 0, bottom: 0 });
  useEffect(() => {
    const measure = () => {
      const box = { left: Infinity, top: Infinity, right: 0, bottom: 0 };
      let right = 0;
      // Measure the text itself, not its boxes (some lines span the full width).
      const range = document.createRange();
      document.querySelectorAll("#top h1, #top p").forEach((n) => {
        range.selectNodeContents(n);
        const b = range.getBoundingClientRect();
        right = Math.max(right, b.right);
        box.left = Math.min(box.left, b.left); box.right = Math.max(box.right, b.right);
        box.top = Math.min(box.top, b.top + scrollY); box.bottom = Math.max(box.bottom, b.bottom + scrollY);
      });
      heroBox.current = box;
      heroEdge.current = right ? right + 40 : 0;
    };
    measure();
    addEventListener("resize", measure);
    document.fonts?.ready.then(measure);
    return () => removeEventListener("resize", measure);
  }, []);
  const colors = useMemo(() => ({
    node: cssColor("--c-node", "#f4f8fd"), host: cssColor("--c-host", "#6f8fb4"),
    edge: cssColor("--c-edge", "#8fb5e0"), traffic: cssColor("--c-traffic", "#ffd23f"),
  }), []);
  const wide = size.width >= 1024;

  const lineGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const arr = new Float32Array(edges.length * 6);
    edges.forEach(([a, b], i) => { pts[a].toArray(arr, i * 6); pts[b].toArray(arr, i * 6 + 3); });
    g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    return g;
  }, [edges, pts]);

  const traffic = useMemo(() => {
    const rand = rng(7);
    return Array.from({ length: TRAFFIC }, () => ({ e: Math.floor(rand() * edges.length), t: rand(), v: 0.22 + rand() * 0.45 }));
  }, [edges.length]);
  const packetGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(TRAFFIC * 3), 3));
    return g;
  }, []);

  // A soft round sprite for the traffic, so packets read as points of light rather than square pixels.
  const dot = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d")!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "#fff"); grad.addColorStop(0.45, "rgba(255,255,255,0.85)"); grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }, []);
  // Three faint, inclined orbit paths so the constellation reads as satellites in orbit, not a mesh.
  const orbitGeo = useMemo(() => {
    const pts = Array.from({ length: 129 }, (_, i) => {
      const a = (i / 128) * Math.PI * 2;
      return new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius);
    });
    return new THREE.BufferGeometry().setFromPoints(pts);
  }, [radius]);
  const orbits = useMemo(() => {
    const mat = new THREE.LineBasicMaterial({ color: colors.edge, transparent: true, opacity: 0.15, depthWrite: false });
    return [[0.35, 0], [-0.6, 0.9], [1.15, 2.1]].map(([tilt, turn]) => {
      const l = new THREE.Line(orbitGeo, mat);
      l.rotation.set(tilt, turn, 0);
      return l;
    });
  }, [orbitGeo, colors.edge]);

  const hostIdx = useMemo(() => pts.map((_, i) => i).filter((i) => !labelled.includes(i)), [pts, labelled]);

  useEffect(() => {
    const m = new THREE.Matrix4();
    labelled.forEach((p, i) => {
      m.makeTranslation(pts[p].x, pts[p].y, pts[p].z);
      big.current!.setMatrixAt(i, m);
      halo.current!.setMatrixAt(i, m);
    });
    hostIdx.forEach((p, i) => { m.makeTranslation(pts[p].x, pts[p].y, pts[p].z); small.current!.setMatrixAt(i, m); });
    big.current!.instanceMatrix.needsUpdate = true;
    halo.current!.instanceMatrix.needsUpdate = true;
    small.current!.instanceMatrix.needsUpdate = true;
  }, [labelled, hostIdx, pts]);

  useEffect(() => {
    labelled.forEach((_, i) => big.current!.setColorAt(i, (i === hovered ? colors.traffic : colors.node).clone().multiplyScalar(1.8)));
    if (big.current!.instanceColor) big.current!.instanceColor.needsUpdate = true;
    labels.current?.forEach((el, i) => el?.classList.toggle("is-hot", i === hovered));
  }, [hovered, labelled, colors, labels]);

  useEffect(() => {
    const move = (e: PointerEvent) => { pointer.current = { x: e.clientX / innerWidth - 0.5, y: e.clientY / innerHeight - 0.5 }; };
    addEventListener("pointermove", move);
    return () => removeEventListener("pointermove", move);
  }, []);

  const v = useMemo(() => new THREE.Vector3(), []);
  const fwd = useMemo(() => new THREE.Vector3(), []);
  const ray = useMemo(() => new THREE.Vector3(), []);
  const oc = useMemo(() => new THREE.Vector3(), []);
  let camDist = 0;
  const placed = useMemo(() => labelled.map(() => ({ x: 0, y: 0, d: 0, w: 0 })), [labelled]);
  useFrame((_, dt) => {
    const g = group.current!;
    if (!still) g.rotation.y += dt * (hovered === null ? 0.035 : 0.008);
    g.rotation.x += (0.32 + pointer.current.y * 0.12 - g.rotation.x) * 0.04;
    g.rotation.z += (-pointer.current.x * 0.06 - g.rotation.z) * 0.04;
    g.updateMatrixWorld();
    camDist = camera.position.distanceTo(g.position);

    const pos = packetGeo.attributes.position as THREE.BufferAttribute;
    traffic.forEach((p, i) => {
      if (!still) {
        p.t += dt * p.v;
        if (p.t > 1) { p.t = 0; p.e = (p.e * 7 + 3) % edges.length; }
      }
      const [a, b] = edges[p.e];
      pos.setXYZ(i, pts[a].x + (pts[b].x - pts[a].x) * p.t, pts[a].y + (pts[b].y - pts[a].y) * p.t, pts[a].z + (pts[b].z - pts[a].z) * p.t);
    });
    pos.needsUpdate = true;

    // Pin each name to its node. Nearer names win: a name is shown only if it doesn't collide with a nearer
    // one and fits on screen, and names on the far side fade so the front of the network reads first.
    camera.getWorldDirection(fwd);
    labelled.forEach((p, i) => {
      v.copy(pts[p]).applyMatrix4(g.matrixWorld);
      // Nearness to the camera across the shell (1 = nearest side), and whether the planet is in the way.
      ray.copy(v).sub(camera.position);
      const dist = ray.length();
      const d = 1 - (dist - (camDist - radius)) / (2 * radius);
      ray.normalize();
      oc.copy(camera.position).sub(g.position);
      const b = oc.dot(ray), c = oc.lengthSq() - planetRadius * planetRadius, disc = b * b - c;
      const hidden = disc > 0 && -b - Math.sqrt(disc) < dist;
      const behind = v.clone().sub(camera.position).dot(fwd) < 0.5 || hidden;
      v.project(camera);
      const el = labels.current?.[i];
      placed[i] = { x: behind ? -999 : (v.x * 0.5 + 0.5) * size.width + 16, y: (-v.y * 0.5 + 0.5) * size.height - 9, d, w: el ? el.offsetWidth : 80 };
    });
    const shown: { x: number; y: number; w: number }[] = [];
    const heroRight = heroEdge.current || size.width * 0.52;
    labelled.map((_, i) => i).sort((a, b) => placed[b].d - placed[a].d).forEach((i) => {
      const el = labels.current?.[i];
      if (!el) return;
      const r = placed[i];
      // On wide screens the words sit over the left of the map, so no names there.
      const fits = r.x > (wide ? heroRight : 4) && r.x + r.w < size.width - 4 && r.y > 70 && r.y < (wide ? size.height - 24 : size.height * 0.46);
      const h = heroBox.current, top = h.top - scrollY, bottom = h.bottom - scrollY;
      const onHero = r.x < h.right + 12 && r.x + r.w > h.left - 12 && r.y + 20 > top - 12 && r.y < bottom + 12;
      const clear = !onHero && !shown.some((o) => r.x < o.x + o.w + 10 && o.x < r.x + r.w + 10 && Math.abs(r.y - o.y) < 20);
      const front = r.d > 0.35;
      const show = fits && clear && front;
      if (show) shown.push(r);
      el.style.transform = `translate(${r.x}px, ${r.y}px)`;
      el.style.opacity = show ? String(Math.min(1, 0.8 + r.d * 0.2)) : "0";
    });
  });

  const over = (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); setHovered(e.instanceId ?? null); };

  return (
    <group ref={group} position={position}>
      <lineSegments geometry={lineGeo}>
        <lineBasicMaterial color={colors.edge} transparent opacity={0.22} depthWrite={false} />
      </lineSegments>
      <instancedMesh ref={small} args={[undefined, undefined, hostIdx.length]}>
        <sphereGeometry args={[radius * 0.0045, 8, 8]} />
        <meshBasicMaterial color={colors.host.clone().multiplyScalar(1.6)} toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={halo} args={[undefined, undefined, labelled.length]}>
        <sphereGeometry args={[radius * 0.022, 16, 16]} />
        <meshBasicMaterial color={colors.node} transparent opacity={0.06} depthWrite={false} blending={THREE.AdditiveBlending} />
      </instancedMesh>
      <instancedMesh
        ref={big}
        args={[undefined, undefined, labelled.length]}
        onPointerMove={over}
        onPointerOut={() => setHovered(null)}
      >
        <sphereGeometry args={[radius * 0.0085, 16, 16]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <points geometry={packetGeo}>
        <pointsMaterial color={colors.traffic} size={radius * 0.018} sizeAttenuation map={dot} alphaTest={0.02} transparent opacity={1} blending={THREE.AdditiveBlending} depthWrite={false} />
      </points>
      {orbits.map((o, i) => <primitive key={i} object={o} />)}
    </group>
  );
}

