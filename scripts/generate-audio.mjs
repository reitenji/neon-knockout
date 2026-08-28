import { mkdir, writeFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SAMPLE_RATE = 44_100;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;
const TWO_PI = Math.PI * 2;
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const outputDirectory = path.resolve(scriptDirectory, '../public/assets/audio');

const clamp = (value, minimum = -1, maximum = 1) => Math.max(minimum, Math.min(maximum, value));
const sine = (frequency, time, phase = 0) => Math.sin(TWO_PI * frequency * time + phase);

function chirp(startHz, endHz, time, duration, phase = 0) {
  const sweep = (endHz - startHz) / duration;
  return Math.sin(TWO_PI * (startHz * time + 0.5 * sweep * time * time) + phase);
}

function envelope(time, duration, attack = 0.008, release = 0.06) {
  const fadeIn = Math.min(1, time / attack);
  const fadeOut = Math.min(1, (duration - time) / release);
  return Math.max(0, Math.min(fadeIn, fadeOut));
}

function hashName(name) {
  let hash = 2_166_136_261;
  for (const character of name) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function noise(sampleIndex, seed) {
  let value = (sampleIndex + seed) | 0;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value ^= value >>> 16;
  return ((value >>> 0) / 0xffff_ffff) * 2 - 1;
}

function pulse(time, frequency, duty = 0.5) {
  return ((time * frequency) % 1) < duty ? 1 : -1;
}

const cues = [
  {
    name: 'quick', duration: 0.16,
    sample: ({ time, duration, index, seed }) => {
      const body = chirp(920, 210, time, duration) * 0.52;
      const edge = noise(index, seed) * Math.exp(-time * 26) * 0.28;
      return (body + edge) * envelope(time, duration, 0.003, 0.045);
    }
  },
  {
    name: 'heavy-charge', duration: 0.42,
    sample: ({ time, duration }) => {
      const progress = time / duration;
      const rise = chirp(92, 390, time, duration) * 0.46;
      const harmonic = chirp(184, 780, time, duration, Math.PI / 3) * 0.18;
      return (rise + harmonic) * Math.pow(progress, 0.7) * envelope(time, duration, 0.015, 0.035);
    }
  },
  {
    name: 'heavy-release', duration: 0.22,
    sample: ({ time, duration, index, seed }) => {
      const strike = chirp(640, 74, time, duration) * 0.58;
      const transient = noise(index, seed) * Math.exp(-time * 34) * 0.3;
      const bass = sine(82, time) * 0.22;
      return (strike + transient + bass) * envelope(time, duration, 0.002, 0.075);
    }
  },
  {
    name: 'hit', duration: 0.14,
    sample: ({ time, duration, index, seed }) => {
      const crack = noise(index, seed) * Math.exp(-time * 38) * 0.54;
      const ring = sine(188, time) * Math.exp(-time * 16) * 0.42;
      const metal = sine(1_260, time) * Math.exp(-time * 31) * 0.14;
      return (crack + ring + metal) * envelope(time, duration, 0.0015, 0.035);
    }
  },
  {
    name: 'dash', duration: 0.18,
    sample: ({ time, duration, index, seed }) => {
      const sweep = chirp(1_450, 190, time, duration) * 0.38;
      const air = noise(index, seed) * (1 - time / duration) * 0.22;
      return (sweep + air) * envelope(time, duration, 0.003, 0.045);
    }
  },
  {
    name: 'knockout', duration: 0.55,
    sample: ({ time, duration, index, seed }) => {
      const shock = chirp(118, 36, time, duration) * 0.55;
      const debris = noise(index, seed) * Math.exp(-time * 7.5) * 0.25;
      const ring = sine(520, time) * Math.exp(-time * 5.2) * 0.17;
      return (shock + debris + ring) * envelope(time, duration, 0.002, 0.12);
    }
  },
  {
    name: 'respawn', duration: 0.38,
    sample: ({ time, duration }) => {
      const rise = chirp(170, 760, time, duration) * 0.4;
      const shimmer = chirp(340, 1_520, time, duration, Math.PI / 2) * 0.18;
      const bloom = Math.sin(Math.PI * time / duration);
      return (rise + shimmer) * bloom * envelope(time, duration, 0.012, 0.065);
    }
  },
  {
    name: 'countdown', duration: 0.18,
    sample: ({ time, duration }) => {
      const tone = sine(620, time) * 0.45 + sine(930, time) * 0.18;
      return tone * envelope(time, duration, 0.004, 0.055);
    }
  },
  {
    name: 'warning', duration: 0.45,
    sample: ({ time, duration }) => {
      const sirenFrequency = 330 + 82 * Math.sin(TWO_PI * 3.2 * time);
      const signal = sine(sirenFrequency, time) * 0.35 + pulse(time, 6.4, 0.42) * 0.09;
      return signal * envelope(time, duration, 0.012, 0.07);
    }
  },
  {
    name: 'victory', duration: 0.8,
    sample: ({ time, duration }) => {
      const notes = [523.25, 659.25, 783.99, 1_046.5];
      const noteIndex = Math.min(notes.length - 1, Math.floor(time / (duration / notes.length)));
      const noteTime = time % (duration / notes.length);
      const noteEnvelope = Math.exp(-noteTime * 5.5);
      const frequency = notes[noteIndex];
      const chord = sine(frequency, time) * 0.42 + sine(frequency * 2, time) * 0.12;
      return chord * noteEnvelope * envelope(time, duration, 0.006, 0.11);
    }
  }
];

function encodeWav(name, duration, sampleFunction) {
  const sampleCount = Math.floor(duration * SAMPLE_RATE);
  const bytesPerSample = BITS_PER_SAMPLE / 8;
  const dataSize = sampleCount * CHANNELS * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);
  const seed = hashName(name);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(CHANNELS, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * CHANNELS * bytesPerSample, 28);
  buffer.writeUInt16LE(CHANNELS * bytesPerSample, 32);
  buffer.writeUInt16LE(BITS_PER_SAMPLE, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let index = 0; index < sampleCount; index += 1) {
    const time = index / SAMPLE_RATE;
    const value = clamp(sampleFunction({ time, duration, index, seed }));
    buffer.writeInt16LE(Math.round(value * 32_767), 44 + index * bytesPerSample);
  }
  return buffer;
}

await mkdir(outputDirectory, { recursive: true });
for (const cue of cues) {
  const wav = encodeWav(cue.name, cue.duration, cue.sample);
  await writeFile(path.join(outputDirectory, `${cue.name}.wav`), wav);
}

process.stdout.write(`Generated ${cues.length} deterministic WAV cues in ${outputDirectory}\n`);
