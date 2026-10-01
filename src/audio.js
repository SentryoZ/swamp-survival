// Tiny WebAudio synth: all sound is generated (no asset files). The context is
// created lazily and resumed on the first user gesture (autoplay policy).
let ctx = null;
let master = null;
let musicGain = null;
let enabled = true;
let musicTimer = null;
const lastPlayed = new Map();

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.35;
  master.connect(ctx.destination);
  musicGain = ctx.createGain();
  musicGain.gain.value = 0.5;
  musicGain.connect(master);
  return ctx;
}

export function initAudio() {
  const resume = () => {
    const c = ensure();
    if (c && c.state === "suspended") c.resume();
  };
  window.addEventListener("pointerdown", resume);
  window.addEventListener("keydown", resume);
  ensure();
  startMusic();
}

function tone(type, freq, dur, vol, opts = {}) {
  if (!enabled) return;
  const c = ensure();
  if (!c) return;
  const t0 = c.currentTime + (opts.delay || 0);
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (opts.to) osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.to), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(opts.bus || master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

function noise(dur, vol, cutoff) {
  if (!enabled) return;
  const c = ensure();
  if (!c) return;
  const t0 = c.currentTime;
  const frames = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, frames, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  const src = c.createBufferSource();
  src.buffer = buf;
  const filt = c.createBiquadFilter();
  filt.type = "lowpass";
  filt.frequency.value = cutoff;
  const g = c.createGain();
  g.gain.value = vol;
  src.connect(filt).connect(g).connect(master);
  src.start(t0);
  src.stop(t0 + dur);
}

const SFX = {
  shoot: () => tone("square", 660, 0.06, 0.1, { to: 320 }),
  hit: () => tone("triangle", 320, 0.05, 0.14, { to: 200 }),
  kill: () => {
    tone("sawtooth", 220, 0.16, 0.2, { to: 80 });
    noise(0.14, 0.1, 1300);
  },
  hurt: () => tone("sawtooth", 180, 0.2, 0.26, { to: 70 }),
  levelup: () => {
    tone("square", 523, 0.09, 0.2);
    tone("square", 659, 0.09, 0.2, { delay: 0.09 });
    tone("square", 784, 0.14, 0.2, { delay: 0.18 });
  },
  crate: () => {
    noise(0.16, 0.22, 900);
    tone("square", 300, 0.12, 0.14, { to: 120 });
  },
  magnet: () => tone("sine", 520, 0.28, 0.2, { to: 1040 }),
  bomb: () => {
    noise(0.4, 0.34, 600);
    tone("sawtooth", 120, 0.35, 0.22, { to: 40 });
  },
  freeze: () => {
    tone("sine", 1300, 0.32, 0.16, { to: 420 });
    tone("sine", 1700, 0.18, 0.08, { delay: 0.05 });
  },
  death: () => tone("sawtooth", 300, 0.6, 0.28, { to: 60 }),
  ui: () => tone("square", 520, 0.05, 0.14, { to: 620 }),
};

const THROTTLE = { shoot: 0.045, hit: 0.04, kill: 0.03, hurt: 0.25, crate: 0.05 };

export function playSfx(name) {
  if (!enabled) return;
  const fn = SFX[name];
  if (!fn) return;
  const min = THROTTLE[name] || 0;
  if (min) {
    const now = performance.now() / 1000;
    if (now - (lastPlayed.get(name) || 0) < min) return;
    lastPlayed.set(name, now);
  }
  fn();
}

function startMusic() {
  if (musicTimer) return;
  const c = ensure();
  if (!c) return;
  const bass = [110, 110, 146.83, 130.81];
  let step = 0;
  musicTimer = setInterval(() => {
    if (!enabled) return;
    tone("triangle", bass[step % bass.length], 0.35, 0.05, { bus: musicGain });
    if (step % 4 === 2) tone("sine", 440, 0.22, 0.028, { bus: musicGain });
    step++;
  }, 430);
}

export function toggleSound() {
  enabled = !enabled;
  return enabled;
}

export function isSoundOn() {
  return enabled;
}
