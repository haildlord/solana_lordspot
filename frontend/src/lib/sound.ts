/** Synthesized (no audio files) sound effects for the ticket-reveal animation. */

let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  try {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** A heavy "thud" — weight 0..1 controls depth/loudness/decay (used for each revealed ball). */
export function playThud(weight = 0): void {
  const audio = getContext();
  if (!audio) return;

  const now = audio.currentTime;
  const w = Math.min(1, Math.max(0, weight));

  const osc = audio.createOscillator();
  osc.type = 'sine';
  const freqStart = 170 - w * 70;
  osc.frequency.setValueAtTime(freqStart, now);
  osc.frequency.exponentialRampToValueAtTime(Math.max(28, freqStart * 0.35), now + 0.18 + w * 0.12);

  const gain = audio.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.45 + w * 0.35, now + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28 + w * 0.18);

  osc.connect(gain).connect(audio.destination);
  osc.start(now);
  osc.stop(now + 0.55 + w * 0.25);

  const bufferSize = Math.floor(audio.sampleRate * 0.15);
  const buffer = audio.createBuffer(1, bufferSize, audio.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize) ** 2;
  }
  const noise = audio.createBufferSource();
  noise.buffer = buffer;
  const filter = audio.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 280 + w * 220;
  const noiseGain = audio.createGain();
  noiseGain.gain.setValueAtTime(0.12 + w * 0.18, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16 + w * 0.1);
  noise.connect(filter).connect(noiseGain).connect(audio.destination);
  noise.start(now);
}

/** A bright ascending chime for a winning reveal. */
export function playWinChime(): void {
  const audio = getContext();
  if (!audio) return;

  const now = audio.currentTime;
  const notes = [523.25, 659.25, 783.99, 1046.5];
  notes.forEach((freq, i) => {
    const start = now + i * 0.09;
    const osc = audio.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, start);
    const gain = audio.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.5);
    osc.connect(gain).connect(audio.destination);
    osc.start(start);
    osc.stop(start + 0.55);
  });
}
