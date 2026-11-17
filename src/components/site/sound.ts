// The site's sound, all synthesised in the browser with the Web Audio API: no audio files, so nothing to
// download and nothing to license. Off until the visitor turns it on (browsers only allow audio after a click
// or key press anyway); the choice is remembered, and a returning visitor who left it on hears it again from
// their first click.
//
//   music     a generative lofi loop: jazzy electric-piano chords, a soft bass, muffled boom-bap drums,
//             vinyl crackle and a little tape wobble
//   ambience  a low server-room hum while in the data hall
//   effects   a whoosh between stops, a deeper dive into the hall, a soft tick on clicks, and a terminal
//             chime when the contact form goes live
//
// The page tells it what's happening with window events: "journey:stop" (detail: stop id), "journey:route"
// (detail: "space" | "hall") and "journey:contact".

const KEY = "sound";
const BPM = 72;
const BEAT = 60 / BPM;
const SWING = 0.18; // how late the off-beat eighths land, as a share of an eighth
// Fmaj7, Em7, Dm9, Cmaj9: one bar each, as MIDI notes (keys), with the bass root.
const CHORDS: { keys: number[]; root: number }[] = [
  { keys: [53, 57, 60, 64], root: 41 },
  { keys: [52, 55, 59, 62], root: 40 },
  { keys: [50, 53, 57, 60, 64], root: 38 },
  { keys: [48, 52, 55, 59, 62], root: 36 },
];
const hz = (m: number) => 440 * 2 ** ((m - 69) / 12);

type Listener = (on: boolean) => void;

class Sound {
  on = false;
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private music!: GainNode;
  private sfx!: GainNode;
  private hum!: GainNode;
  private keysOut!: BiquadFilterNode;
  private drumsOut!: BiquadFilterNode;
  private wobble!: GainNode;
  private noise!: AudioBuffer;
  private timer = 0;
  private nextTime = 0;
  private step = 0; // eighth notes since start
  private listeners = new Set<Listener>();

  subscribe(fn: Listener) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit() { this.listeners.forEach((fn) => fn(this.on)); }

  wanted() { try { return localStorage.getItem(KEY) === "on"; } catch { return false; } }

  toggle() { if (this.on) this.disable(); else this.enable(); }

  enable() {
    if (!this.ctx) this.build();
    const ctx = this.ctx!;
    void ctx.resume();
    this.master.gain.cancelScheduledValues(ctx.currentTime);
    this.master.gain.setTargetAtTime(0.9, ctx.currentTime, 0.4);
    if (!this.timer) {
      this.nextTime = ctx.currentTime + 0.1;
      this.timer = window.setInterval(() => this.schedule(), 25);
    }
    this.on = true;
    try { localStorage.setItem(KEY, "on"); } catch { /* private mode */ }
    this.emit();
  }

  disable() {
    this.on = false;
    try { localStorage.setItem(KEY, "off"); } catch { /* private mode */ }
    if (this.ctx) {
      const ctx = this.ctx;
      this.master.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
      window.clearInterval(this.timer);
      this.timer = 0;
      window.setTimeout(() => { if (!this.on) void ctx.suspend(); }, 800);
    }
    this.emit();
  }

  // ---- graph ---------------------------------------------------------------------------------------------
  private build() {
    const ctx = new AudioContext();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 3;
    comp.connect(ctx.destination);
    this.master = ctx.createGain(); this.master.gain.value = 0; this.master.connect(comp);
    this.music = ctx.createGain(); this.music.gain.value = 0.32; this.music.connect(this.master);
    this.sfx = ctx.createGain(); this.sfx.gain.value = 0.55; this.sfx.connect(this.master);
    this.hum = ctx.createGain(); this.hum.gain.value = 0; this.hum.connect(this.master);

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    // Keys go through a warm low-pass with a slow tremolo; drums through a darker one ("muffled").
    this.keysOut = ctx.createBiquadFilter(); this.keysOut.type = "lowpass"; this.keysOut.frequency.value = 1500;
    const trem = ctx.createGain(); trem.gain.value = 0.85;
    const tremLfo = ctx.createOscillator(); tremLfo.frequency.value = 4.2;
    const tremDepth = ctx.createGain(); tremDepth.gain.value = 0.12;
    tremLfo.connect(tremDepth).connect(trem.gain); tremLfo.start();
    this.keysOut.connect(trem).connect(this.music);
    this.drumsOut = ctx.createBiquadFilter(); this.drumsOut.type = "lowpass"; this.drumsOut.frequency.value = 3200;
    this.drumsOut.connect(this.music);
    // Tape wobble: a slow drift in pitch, in cents, shared by every keys oscillator.
    const wob = ctx.createOscillator(); wob.frequency.value = 0.35;
    this.wobble = ctx.createGain(); this.wobble.gain.value = 9;
    wob.connect(this.wobble); wob.start();

    // Vinyl: a quiet band of hiss, plus crackle scheduled with the music.
    const hiss = ctx.createBufferSource(); hiss.buffer = this.noise; hiss.loop = true;
    const hissBand = ctx.createBiquadFilter(); hissBand.type = "bandpass"; hissBand.frequency.value = 3000; hissBand.Q.value = 0.6;
    const hissGain = ctx.createGain(); hissGain.gain.value = 0.018;
    hiss.connect(hissBand).connect(hissGain).connect(this.music); hiss.start();

    // Server-room hum for the data hall: low rumble and a faint mains tone.
    const rumble = ctx.createBufferSource(); rumble.buffer = this.noise; rumble.loop = true;
    const rumbleLp = ctx.createBiquadFilter(); rumbleLp.type = "lowpass"; rumbleLp.frequency.value = 160;
    const rumbleGain = ctx.createGain(); rumbleGain.gain.value = 0.5;
    rumble.connect(rumbleLp).connect(rumbleGain).connect(this.hum); rumble.start();
    const mains = ctx.createOscillator(); mains.frequency.value = 100;
    const mainsGain = ctx.createGain(); mainsGain.gain.value = 0.025;
    mains.connect(mainsGain).connect(this.hum); mains.start();

    // Clicks on links and buttons get a soft tick.
    document.addEventListener("click", (e) => {
      if ((e.target as Element | null)?.closest?.("a, button, summary")) this.tick();
    });
    addEventListener("journey:stop", () => this.whoosh(0.7));
    addEventListener("journey:route", (e) => {
      const hall = (e as CustomEvent<string>).detail === "hall";
      if (hall) this.dive();
      this.hum.gain.setTargetAtTime(hall ? 0.22 : 0, ctx.currentTime, 0.8);
    });
    addEventListener("journey:contact", () => this.chime());
  }

  // ---- music ---------------------------------------------------------------------------------------------
  private schedule() {
    const ctx = this.ctx!;
    while (this.nextTime < ctx.currentTime + 0.15) {
      this.playStep(this.step, this.nextTime);
      this.nextTime += BEAT / 2;
      this.step++;
    }
  }

  private playStep(step: number, t0: number) {
    const eighth = step % 8, bar = Math.floor(step / 8);
    const t = t0 + (eighth % 2 === 1 ? (BEAT / 2) * SWING : 0);
    const chord = CHORDS[bar % CHORDS.length];
    if (eighth === 0) this.keys(chord.keys, t, BEAT * 2.6, 0.16);
    if (eighth === 3) this.keys(chord.keys.slice(1), t, BEAT * 1.6, 0.1);
    if (eighth === 0 || eighth === 5) this.bass(chord.root, t, eighth === 0 ? BEAT * 1.4 : BEAT * 0.9);
    if (eighth === 0 || eighth === 5) this.kick(t);
    if (eighth === 2 || eighth === 6) this.snare(t);
    this.hat(t, eighth % 2 === 0 ? 0.05 : 0.03);
    // Now and then a high melody note from the chord, like a music box.
    if ((eighth === 4 || eighth === 7) && Math.random() < 0.3) {
      const n = chord.keys[Math.floor(Math.random() * chord.keys.length)] + 24;
      this.bell(n, t);
    }
    if (Math.random() < 0.5) this.crackle(t + Math.random() * (BEAT / 2));
  }

  private keys(notes: number[], t: number, len: number, vel: number) {
    const ctx = this.ctx!;
    notes.forEach((n, i) => {
      const s = t + i * 0.012; // a slight strum
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(vel, s + 0.012);
      g.gain.exponentialRampToValueAtTime(vel * 0.35, s + 0.6);
      g.gain.exponentialRampToValueAtTime(0.0001, s + len);
      g.connect(this.keysOut);
      for (const [type, mult, amp] of [["sine", 1, 1], ["triangle", 2, 0.18]] as const) {
        const o = ctx.createOscillator(); o.type = type; o.frequency.value = hz(n) * mult;
        this.wobble.connect(o.detune);
        const og = ctx.createGain(); og.gain.value = amp;
        o.connect(og).connect(g); o.start(s); o.stop(s + len + 0.05);
        o.onended = () => this.wobble.disconnect(o.detune);
      }
    });
  }

  private bass(n: number, t: number, len: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator(); o.type = "triangle"; o.frequency.value = hz(n);
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 380;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.4, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(lp).connect(g).connect(this.music); o.start(t); o.stop(t + len + 0.05);
  }

  private kick(t: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.18);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(g).connect(this.drumsOut); o.start(t); o.stop(t + 0.4);
  }

  private snare(t: number) {
    const ctx = this.ctx!;
    const n = ctx.createBufferSource(); n.buffer = this.noise;
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1800; bp.Q.value = 0.8;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.32, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    n.connect(bp).connect(g).connect(this.drumsOut); n.start(t, Math.random()); n.stop(t + 0.25);
    const o = ctx.createOscillator(); o.frequency.value = 185;
    const og = ctx.createGain(); og.gain.setValueAtTime(0.18, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    o.connect(og).connect(this.drumsOut); o.start(t); o.stop(t + 0.12);
  }

  private hat(t: number, vel: number) {
    const ctx = this.ctx!;
    const n = ctx.createBufferSource(); n.buffer = this.noise;
    const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 7000;
    const g = ctx.createGain(); g.gain.setValueAtTime(vel, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    n.connect(hp).connect(g).connect(this.drumsOut); n.start(t, Math.random()); n.stop(t + 0.06);
  }

  private bell(n: number, t: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator(); o.frequency.value = hz(n);
    this.wobble.connect(o.detune);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.06, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    o.connect(g).connect(this.keysOut); o.start(t); o.stop(t + 1.5);
    o.onended = () => this.wobble.disconnect(o.detune);
  }

  private crackle(t: number) {
    const ctx = this.ctx!;
    const n = ctx.createBufferSource(); n.buffer = this.noise;
    const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 2500;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.05 + Math.random() * 0.06, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.012);
    n.connect(hp).connect(g).connect(this.music); n.start(t, Math.random() * 1.9); n.stop(t + 0.015);
  }

  // ---- effects -------------------------------------------------------------------------------------------
  whoosh(amount = 1) {
    if (!this.on || !this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = ctx.createBufferSource(); n.buffer = this.noise;
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(300, t); bp.frequency.exponentialRampToValueAtTime(2200, t + 0.45); bp.frequency.exponentialRampToValueAtTime(500, t + 1);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.35 * amount, t + 0.35); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.05);
    const pan = ctx.createStereoPanner(); pan.pan.setValueAtTime(-0.6, t); pan.pan.linearRampToValueAtTime(0.6, t + 1);
    n.connect(bp).connect(g).connect(pan).connect(this.sfx); n.start(t, Math.random()); n.stop(t + 1.1);
  }

  dive() {
    if (!this.on || !this.ctx) return;
    this.whoosh(1.2);
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(38, t + 1.3);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.4, t + 0.15); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    o.connect(g).connect(this.sfx); o.start(t); o.stop(t + 1.5);
  }

  tick() {
    if (!this.on || !this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.frequency.value = 1750;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.connect(g).connect(this.sfx); o.start(t); o.stop(t + 0.06);
  }

  chime() {
    if (!this.on || !this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    [660, 880, 1320].forEach((f, i) => {
      const s = t + i * 0.09;
      const o = ctx.createOscillator(); o.type = "square"; o.frequency.value = f;
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 2400;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.07, s); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.16);
      o.connect(lp).connect(g).connect(this.sfx); o.start(s); o.stop(s + 0.18);
    });
  }
}

export const sound = typeof window === "undefined" ? null : new Sound();

