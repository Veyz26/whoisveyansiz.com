"use client";

import { create } from "zustand";

// Single shared audio engine for the experience, synthesised entirely with the
// Web Audio API (no audio files → CSP-safe). One master toggle controls
// everything:
//   • a cinematic "Inception-style" ambient bed (deep detuned drone + slow
//     "BRAAAM" horn swells + procedural convolution reverb)
//   • soothing sci-fi UI blips on button presses — each a soft sine note picked
//     from a pentatonic scale, so any sequence of clicks stays musical.
// UI sounds only fire while sound is enabled, so the site is silent until the
// visitor opts in (a deliberate gesture, which also satisfies autoplay policy).

const MASTER_VOLUME = 0.08;
const SWELL_INTERVAL_MS = 15000;
// C5 D5 E5 G5 A5 — a major pentatonic: every note sounds pleasant together.
const PENTATONIC = [523.25, 587.33, 659.25, 783.99, 880.0];

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let dry: GainNode | null = null;
let reverb: ConvolverNode | null = null;
let swellTimer: number | null = null;
let enabledFlag = false;

function makeReverb(c: AudioContext): ConvolverNode {
  const len = Math.floor(c.sampleRate * 3.4);
  const buf = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
  }
  const conv = c.createConvolver();
  conv.buffer = buf;
  return conv;
}

function send(node: AudioNode) {
  if (dry) node.connect(dry);
  if (reverb) node.connect(reverb);
}

function build() {
  if (ctx) return;
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  ctx = new Ctor();

  master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);

  dry = ctx.createGain();
  dry.gain.value = 0.85;
  dry.connect(master);

  reverb = makeReverb(ctx);
  const wet = ctx.createGain();
  wet.gain.value = 0.7;
  reverb.connect(wet);
  wet.connect(master);

  // ── Continuous drone: sub bass + detuned saw pad through a lowpass ──
  const droneFilter = ctx.createBiquadFilter();
  droneFilter.type = "lowpass";
  droneFilter.frequency.value = 300;
  droneFilter.Q.value = 0.7;
  send(droneFilter);

  const sub = ctx.createOscillator();
  sub.type = "sine";
  sub.frequency.value = 36.71; // D1
  const subGain = ctx.createGain();
  subGain.gain.value = 0.55;
  sub.connect(subGain);
  subGain.connect(droneFilter);
  sub.start();

  [73.42, 110.0].forEach((freq, i) => {
    [-7, 7].forEach((det) => {
      const o = ctx!.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = freq; // D2, A2
      o.detune.value = det;
      const g = ctx!.createGain();
      g.gain.value = i === 0 ? 0.1 : 0.07;
      o.connect(g);
      g.connect(droneFilter);
      o.start();
    });
  });

  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.04;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 170;
  lfo.connect(lfoGain);
  lfoGain.connect(droneFilter.frequency);
  lfo.start();
}

/** One slow brass "BRAAAM" swell — a D power chord that rises and decays. */
function swell() {
  if (!ctx) return;
  const now = ctx.currentTime;

  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, now);
  env.gain.exponentialRampToValueAtTime(0.8, now + 2.6);
  env.gain.exponentialRampToValueAtTime(0.0001, now + 8);

  const filt = ctx.createBiquadFilter();
  filt.type = "lowpass";
  filt.frequency.setValueAtTime(170, now);
  filt.frequency.linearRampToValueAtTime(760, now + 2.6);
  filt.frequency.linearRampToValueAtTime(150, now + 8);
  env.connect(filt);
  send(filt);

  const notes: Array<[number, number]> = [
    [73.42, 0.3],
    [110.0, 0.28],
    [146.83, 0.2],
  ];
  notes.forEach(([freq, gain]) => {
    [-6, 6].forEach((det) => {
      const o = ctx!.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = freq;
      o.detune.value = det;
      const g = ctx!.createGain();
      g.gain.value = gain;
      o.connect(g);
      g.connect(env);
      o.start(now);
      o.stop(now + 8.5);
    });
  });
}

function setEnabled(on: boolean) {
  if (on) build();
  if (!ctx || !master) return;
  if (ctx.state === "suspended") void ctx.resume();
  const now = ctx.currentTime;
  master.gain.cancelScheduledValues(now);
  master.gain.setValueAtTime(master.gain.value, now);
  master.gain.linearRampToValueAtTime(on ? MASTER_VOLUME : 0, now + (on ? 2.5 : 1.0));
  enabledFlag = on;
  if (on) {
    swell();
    if (swellTimer) clearInterval(swellTimer);
    swellTimer = window.setInterval(swell, SWELL_INTERVAL_MS);
  } else if (swellTimer) {
    clearInterval(swellTimer);
    swellTimer = null;
  }
}

/** Soothing sci-fi UI sound. Only audible while the master sound is on. */
export function playUi(variant: "tap" | "warp" = "tap") {
  if (!enabledFlag || !ctx) return;
  const now = ctx.currentTime;

  if (variant === "warp") {
    // Gentle rising whoosh for returning to the top.
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(0.13, now + 0.05);
    env.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 2600;
    env.connect(lp);
    send(lp);
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(440, now);
    o.frequency.exponentialRampToValueAtTime(880, now + 0.45);
    o.connect(env);
    o.start(now);
    o.stop(now + 0.65);
    return;
  }

  // Soft pentatonic blip: fundamental sine + a quieter octave shimmer.
  const freq = PENTATONIC[Math.floor(Math.random() * PENTATONIC.length)];
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, now);
  env.gain.exponentialRampToValueAtTime(0.2, now + 0.012);
  env.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 2400;
  lp.Q.value = 0.6;
  env.connect(lp);
  send(lp);

  const o1 = ctx.createOscillator();
  o1.type = "sine";
  o1.frequency.value = freq;
  o1.connect(env);
  o1.start(now);
  o1.stop(now + 0.45);

  const o2 = ctx.createOscillator();
  o2.type = "sine";
  o2.frequency.value = freq * 2;
  const g2 = ctx.createGain();
  g2.gain.value = 0.3;
  o2.connect(g2);
  g2.connect(env);
  o2.start(now);
  o2.stop(now + 0.45);
}

interface SpaceAudioState {
  enabled: boolean;
  toggle: () => void;
}

export const useSpaceAudio = create<SpaceAudioState>((set, get) => ({
  enabled: false,
  toggle: () => {
    const next = !get().enabled;
    setEnabled(next);
    set({ enabled: next });
    if (next) playUi("tap"); // immediate confirmation blip
  },
}));
