// Procedural Web Audio API sound effects & continuous flight audio engine (Role 4).
// Uses zero external audio files so it works offline with 0 KB asset overhead.

export type AlertSoundType =
  | "solar_storm"
  | "debris"
  | "memory_full"
  | "failure"
  | "station_outage";

export interface FlightAudioParams {
  /** True when the 3D scene is running and not paused/completed. */
  active: boolean;
  /** True when flying (post-launch button). */
  flying: boolean;
  /** True during T-3s to T-0s prelaunch main engine ignition on the pad. */
  prelaunchIgnition: boolean;
  /** True when Stage 1 or strap-on boosters are firing. */
  burningBoostersOrS1: boolean;
  /** True when Stage 2 (upper stage / ICPS) is firing. */
  burningS2: boolean;
  /** True when the Crew Service Module engine is firing in space (TLI / TCM). */
  burningService: boolean;
  /** Current engine throttle (0..1). */
  throttle: number;
  /** Spacecraft altitude above Earth (m). */
  altitudeM: number;
  /** Camera altitude above Earth (m). */
  cameraAltitudeM: number;
  /** 0..1 atmospheric re-entry heating factor. */
  heat: number;
  /** Current launch site weather ("clear" | "cloudy" | "rain" | "storm"). */
  weather: "clear" | "cloudy" | "rain" | "storm";
}

type MuteListener = (muted: boolean) => void;

const STORAGE_KEY = "mission_architect_muted";

interface ContinuousLoopNodes {
  engineSource: AudioBufferSourceNode;
  engineFilter1: BiquadFilterNode;
  engineFilter2: BiquadFilterNode;
  engineNoiseGain: GainNode;
  subOsc1: OscillatorNode;
  subOsc2: OscillatorNode;
  subOsc3: OscillatorNode;
  subFilter: BiquadFilterNode;
  subGain: GainNode;
  rainSource: AudioBufferSourceNode;
  rainHighpass: BiquadFilterNode;
  rainLowpass: BiquadFilterNode;
  rainGain: GainNode;
  spaceOsc1: OscillatorNode;
  spaceOsc2: OscillatorNode;
  spaceGain: GainNode;
}

class SoundManager {
  private ctx: AudioContext | null = null;
  private muted: boolean = false;
  private listeners: Set<MuteListener> = new Set();
  private activeLaunchStop: (() => void) | null = null;
  private loopNodes: ContinuousLoopNodes | null = null;
  private lastThunderAt: number = 0;

  constructor() {
    if (typeof window !== "undefined") {
      try {
        this.muted = window.localStorage.getItem(STORAGE_KEY) === "true";
      } catch {
        this.muted = false;
      }
    }
  }

  private getContext(): AudioContext | null {
    if (this.muted || typeof window === "undefined") return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {
        // Ignore autoplay restrictions until user interaction
      });
    }
    return this.ctx;
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public setMuted(value: boolean): boolean {
    this.muted = value;
    if (value) {
      if (this.activeLaunchStop) {
        this.activeLaunchStop();
        this.activeLaunchStop = null;
      }
      this.stopFlightAudio();
    }
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(STORAGE_KEY, String(value));
      } catch {
        // Ignore storage errors in private browsing
      }
    }
    this.listeners.forEach((fn) => fn(this.muted));
    return this.muted;
  }

  public toggleMute(): boolean {
    const next = !this.muted;
    this.setMuted(next);
    if (!next) {
      this.playClick();
    }
    return next;
  }

  public subscribe(listener: MuteListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private ensureLoopNodes(ctx: AudioContext): ContinuousLoopNodes {
    if (this.loopNodes) return this.loopNodes;

    const durationSec = 6.0;
    const sampleRate = ctx.sampleRate;
    const frameCount = Math.floor(sampleRate * durationSec);
    const fadeSamples = Math.floor(sampleRate * 0.2);

    // -------------------------------------------------------------------------
    // 1. Engine Thrust Buffer: Warm saturated brown noise with strong 70–280 Hz body
    // -------------------------------------------------------------------------
    const engineBuffer = ctx.createBuffer(1, frameCount, sampleRate);
    const engineData = engineBuffer.getChannelData(0);
    let e0 = 0.0;
    let ePeak = 0.001;
    for (let i = 0; i < frameCount; i++) {
      const t = i / sampleRate;
      const white = Math.random() * 2 - 1;
      e0 = 0.945 * e0 + 0.055 * white;
      // Add organic rocket exhaust pressure chug (16–28 Hz) + warm tanh saturation
      const chug = 0.82 + 0.18 * Math.sin(t * 21.0 * Math.PI * 2) * Math.cos(t * 9.5 * Math.PI * 2);
      const sample = Math.tanh(e0 * 5.2) * chug;
      engineData[i] = sample;
      const abs = Math.abs(sample);
      if (abs > ePeak) ePeak = abs;
    }
    const eNorm = 0.95 / ePeak;
    for (let i = 0; i < frameCount; i++) {
      engineData[i] *= eNorm;
    }
    for (let i = 0; i < fadeSamples; i++) {
      const a = i / fadeSamples;
      const endIdx = frameCount - fadeSamples + i;
      engineData[endIdx] = engineData[endIdx] * (1 - a) + engineData[i] * a;
    }

    const engineSource = ctx.createBufferSource();
    engineSource.buffer = engineBuffer;
    engineSource.loop = true;

    // Two-stage lowpass at 200–310 Hz: gives full, loud low-mid punch on any speaker
    // while cutting off >450 Hz static hiss
    const engineFilter1 = ctx.createBiquadFilter();
    engineFilter1.type = "lowpass";
    engineFilter1.frequency.value = 240;
    engineFilter1.Q.value = 1.1;

    const engineFilter2 = ctx.createBiquadFilter();
    engineFilter2.type = "lowpass";
    engineFilter2.frequency.value = 290;
    engineFilter2.Q.value = 0.7;

    const engineNoiseGain = ctx.createGain();
    engineNoiseGain.gain.value = 0.0001;

    // Three harmonic oscillators (55 Hz sub, 110 Hz body, 165 Hz upper-stage resonance)
    // so the rocket is clearly audible on both laptop speakers and headphones
    const subOsc1 = ctx.createOscillator();
    subOsc1.type = "sine";
    subOsc1.frequency.value = 55;

    const subOsc2 = ctx.createOscillator();
    subOsc2.type = "triangle";
    subOsc2.frequency.value = 110;

    const subOsc3 = ctx.createOscillator();
    subOsc3.type = "triangle";
    subOsc3.frequency.value = 165;

    const subFilter = ctx.createBiquadFilter();
    subFilter.type = "lowpass";
    subFilter.frequency.value = 230;

    const subGain = ctx.createGain();
    subGain.gain.value = 0.0001;

    // -------------------------------------------------------------------------
    // 2. Dedicated Rain & Wind Patter Buffer (textured droplets + wind swells)
    // -------------------------------------------------------------------------
    const rainBuffer = ctx.createBuffer(1, frameCount, sampleRate);
    const rainData = rainBuffer.getChannelData(0);
    let r0 = 0.0;
    let r1 = 0.0;
    let dropEnv = 0.0;
    let rPeak = 0.001;
    for (let i = 0; i < frameCount; i++) {
      const t = i / sampleRate;
      const white = Math.random() * 2 - 1;
      // Pink-ish water patter + soft wind swell
      r0 = 0.91 * r0 + 0.09 * white;
      r1 = 0.78 * r1 + 0.22 * r0;

      // Random soft raindrop micro-impulses (thousands of gentle drops per second, no harsh clicks)
      if (Math.random() < 0.018) {
        dropEnv = Math.min(1.0, dropEnv + 0.35 + Math.random() * 0.45);
      }
      dropEnv *= 0.988;

      const windSwell =
        0.75 +
        0.25 * Math.sin(t * 0.55 * Math.PI * 2) * Math.cos(t * 0.23 * Math.PI * 2);

      const sample = (r1 * 0.75 + r0 * dropEnv * 0.55) * windSwell;
      rainData[i] = sample;
      const abs = Math.abs(sample);
      if (abs > rPeak) rPeak = abs;
    }
    const rNorm = 0.9 / rPeak;
    for (let i = 0; i < frameCount; i++) {
      rainData[i] *= rNorm;
    }
    for (let i = 0; i < fadeSamples; i++) {
      const a = i / fadeSamples;
      const endIdx = frameCount - fadeSamples + i;
      rainData[endIdx] = rainData[endIdx] * (1 - a) + rainData[i] * a;
    }

    const rainSource = ctx.createBufferSource();
    rainSource.buffer = rainBuffer;
    rainSource.loop = true;

    // Shape the rain between 180 Hz and 520 Hz so it sounds like warm falling rain & wind, not TV static
    const rainHighpass = ctx.createBiquadFilter();
    rainHighpass.type = "highpass";
    rainHighpass.frequency.value = 175;

    const rainLowpass = ctx.createBiquadFilter();
    rainLowpass.type = "lowpass";
    rainLowpass.frequency.value = 480;

    const rainGain = ctx.createGain();
    rainGain.gain.value = 0.0001;

    // -------------------------------------------------------------------------
    // 3. Deep-Space Spacecraft Cabin & Gyro Ambience (heard when in space > 80 km)
    // -------------------------------------------------------------------------
    const spaceOsc1 = ctx.createOscillator();
    spaceOsc1.type = "sine";
    spaceOsc1.frequency.value = 110.0; // A2 cabin carrier
    const spaceOsc2 = ctx.createOscillator();
    spaceOsc2.type = "sine";
    spaceOsc2.frequency.value = 164.81; // E3 fifth harmonic
    const spaceGain = ctx.createGain();
    spaceGain.gain.value = 0.0001;

    // Wire Engine path
    engineSource.connect(engineFilter1);
    engineFilter1.connect(engineFilter2);
    engineFilter2.connect(engineNoiseGain);
    engineNoiseGain.connect(ctx.destination);

    // Wire Engine Harmonics path
    subOsc1.connect(subFilter);
    subOsc2.connect(subFilter);
    subOsc3.connect(subFilter);
    subFilter.connect(subGain);
    subGain.connect(ctx.destination);

    // Wire Rain path
    rainSource.connect(rainHighpass);
    rainHighpass.connect(rainLowpass);
    rainLowpass.connect(rainGain);
    rainGain.connect(ctx.destination);

    // Wire Space Cabin path
    spaceOsc1.connect(spaceGain);
    spaceOsc2.connect(spaceGain);
    spaceGain.connect(ctx.destination);

    const now = ctx.currentTime;
    engineSource.start(now);
    subOsc1.start(now);
    subOsc2.start(now);
    subOsc3.start(now);
    rainSource.start(now);
    spaceOsc1.start(now);
    spaceOsc2.start(now);

    this.loopNodes = {
      engineSource,
      engineFilter1,
      engineFilter2,
      engineNoiseGain,
      subOsc1,
      subOsc2,
      subOsc3,
      subFilter,
      subGain,
      rainSource,
      rainHighpass,
      rainLowpass,
      rainGain,
      spaceOsc1,
      spaceOsc2,
      spaceGain,
    };
    return this.loopNodes;
  }

  /**
   * Updates continuous flight, vacuum thruster, re-entry, and rain/storm ambience every frame.
   */
  public updateFlightAudio(params: FlightAudioParams): void {
    if (this.muted) return;
    const ctx = this.getContext();
    if (!ctx || ctx.state !== "running") return;

    const nodes = this.ensureLoopNodes(ctx);
    const now = ctx.currentTime;
    const tc = 0.08;

    const {
      active,
      flying,
      prelaunchIgnition,
      burningBoostersOrS1,
      burningS2,
      burningService,
      throttle,
      altitudeM,
      cameraAltitudeM,
      heat,
      weather,
    } = params;

    const effThrottle = prelaunchIgnition ? 0.75 : flying ? throttle : 0;
    const anyEngineBurning =
      active &&
      effThrottle > 0.01 &&
      (prelaunchIgnition || burningBoostersOrS1 || burningS2 || burningService);

    let targetNoiseGain = 0.0001;
    let targetCutoff1 = 180;
    let targetCutoff2 = 220;
    let targetSubGain = 0.0001;
    let targetFreq1 = 55;
    let targetFreq2 = 110;
    let targetFreq3 = 165;

    if (anyEngineBurning) {
      if (burningBoostersOrS1 || prelaunchIgnition) {
        // Powerful, full-bodied Stage 1 & Booster roar (strong 90–280 Hz presence)
        const altFactor = Math.max(0.65, Math.exp(-Math.max(0, altitudeM) / 120000));
        targetNoiseGain = 0.68 * altFactor * effThrottle;
        targetCutoff1 = 195 + 85 * altFactor;
        targetCutoff2 = 240 + 95 * altFactor;
        targetSubGain = 0.28 * effThrottle;
        targetFreq1 = 52 + 10 * effThrottle;
        targetFreq2 = 104 + 18 * effThrottle;
        targetFreq3 = 156 + 24 * effThrottle;
      } else if (burningS2) {
        // Upper Stage (Stage 2 / ICPS) climb & Trans-Lunar Injection burn in space
        targetNoiseGain = 0.44 * effThrottle;
        targetCutoff1 = 185;
        targetCutoff2 = 230;
        targetSubGain = 0.24 * effThrottle;
        targetFreq1 = 62 + 8 * effThrottle;
        targetFreq2 = 124 + 16 * effThrottle;
        targetFreq3 = 186 + 22 * effThrottle;
      } else if (burningService) {
        // Service Module orbital maneuvering burn in deep space (TLI / TCM)
        targetNoiseGain = 0.36 * effThrottle;
        targetCutoff1 = 175;
        targetCutoff2 = 215;
        targetSubGain = 0.22 * effThrottle;
        targetFreq1 = 68 + 8 * effThrottle;
        targetFreq2 = 136 + 14 * effThrottle;
        targetFreq3 = 204 + 20 * effThrottle;
      }
    }

    // Re-entry plasma roar when the capsule hits entry interface
    if (active && flying && heat > 0.02) {
      const h = Math.min(1, heat);
      targetNoiseGain = Math.max(targetNoiseGain, 0.58 * h);
      targetCutoff1 = Math.max(targetCutoff1, 210 + 160 * h);
      targetCutoff2 = Math.max(targetCutoff2, 260 + 190 * h);
      targetSubGain = Math.max(targetSubGain, 0.22 * h);
      targetFreq1 = 58 + 18 * h;
      targetFreq2 = 116 + 32 * h;
      targetFreq3 = 174 + 45 * h;
    }

    nodes.engineNoiseGain.gain.setTargetAtTime(targetNoiseGain, now, tc);
    nodes.engineFilter1.frequency.setTargetAtTime(targetCutoff1, now, tc);
    nodes.engineFilter2.frequency.setTargetAtTime(targetCutoff2, now, tc);
    nodes.subGain.gain.setTargetAtTime(targetSubGain, now, tc);
    nodes.subOsc1.frequency.setTargetAtTime(targetFreq1, now, tc);
    nodes.subOsc2.frequency.setTargetAtTime(targetFreq2, now, tc);
    nodes.subOsc3.frequency.setTargetAtTime(targetFreq3, now, tc);

    // --- Rain & Storm Wind Ambience on the Pad and Low Altitude ---
    const nearGroundFactor = Math.max(0, 1 - Math.max(0, cameraAltitudeM) / 25000);
    const isStorm = weather === "storm";
    const isRain = weather === "rain" || isStorm;
    const targetRainGain =
      isRain && nearGroundFactor > 0.02
        ? (isStorm ? 0.28 : 0.22) * nearGroundFactor
        : 0.0001;
    const targetRainLowpass = isStorm ? 460 : 520;

    nodes.rainGain.gain.setTargetAtTime(targetRainGain, now, 0.15);
    nodes.rainLowpass.frequency.setTargetAtTime(targetRainLowpass, now, 0.15);

    // --- Deep-Space Spacecraft Cabin & Gyro Hum (> 80 km altitude) ---
    const inSpace = active && flying && altitudeM > 80000;
    const targetSpaceGain = inSpace ? 0.038 : 0.0001;
    nodes.spaceGain.gain.setTargetAtTime(targetSpaceGain, now, 0.25);
  }

  /** Stops all continuous flight audio loops cleanly. */
  public stopFlightAudio(): void {
    if (!this.loopNodes) return;
    try {
      this.loopNodes.engineSource.stop();
      this.loopNodes.subOsc1.stop();
      this.loopNodes.subOsc2.stop();
      this.loopNodes.subOsc3.stop();
      this.loopNodes.rainSource.stop();
      this.loopNodes.spaceOsc1.stop();
      this.loopNodes.spaceOsc2.stop();
      this.loopNodes.engineSource.disconnect();
      this.loopNodes.engineNoiseGain.disconnect();
      this.loopNodes.subGain.disconnect();
      this.loopNodes.rainGain.disconnect();
      this.loopNodes.spaceGain.disconnect();
    } catch {
      // Ignore already-stopped nodes
    }
    this.loopNodes = null;
  }

  /**
   * Synthesizes a realistic multi-stage rolling thunderclap (3.8 seconds) when weather === "storm".
   */
  public playThunderStrike(intensity: number = 0.85): void {
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    if (now - this.lastThunderAt < 1.25) return;
    this.lastThunderAt = now;

    const scale = Math.max(0.3, Math.min(1.0, intensity));
    const durationSec = 3.8;
    const sampleRate = ctx.sampleRate;
    const frameCount = Math.floor(sampleRate * durationSec);
    const buffer = ctx.createBuffer(1, frameCount, sampleRate);
    const data = buffer.getChannelData(0);

    // Synthesize 4 distinct acoustic thunder swells with strong 80–260 Hz low-mid punch
    let b0 = 0.0;
    let peak = 0.001;
    const phaseJitter = Math.random() * 1.5;

    for (let i = 0; i < frameCount; i++) {
      const t = i / sampleRate;
      const white = Math.random() * 2 - 1;
      b0 = 0.935 * b0 + 0.065 * white;

      const swell1 = Math.exp(-Math.pow((t - 0.16) / 0.15, 2)) * 1.0;
      const swell2 = Math.exp(-Math.pow((t - 0.82) / 0.36, 2)) * 0.85;
      const swell3 = Math.exp(-Math.pow((t - 1.7) / 0.52, 2)) * 0.68;
      const swell4 = Math.exp(-Math.pow((t - 2.7) / 0.72, 2)) * 0.42;

      const flutter =
        0.7 +
        0.3 * Math.sin(t * 12.5 + phaseJitter) * Math.cos(t * 6.8 - phaseJitter);

      const env = (swell1 + swell2 + swell3 + swell4) * flutter;
      const sample = Math.tanh(b0 * 6.5) * env;
      data[i] = sample;
      const abs = Math.abs(sample);
      if (abs > peak) peak = abs;
    }

    const norm = 0.95 / peak;
    for (let i = 0; i < frameCount; i++) {
      data[i] *= norm;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter1 = ctx.createBiquadFilter();
    filter1.type = "lowpass";
    filter1.Q.value = 1.4;
    filter1.frequency.setValueAtTime(320, now);
    filter1.frequency.linearRampToValueAtTime(185, now + 0.5);
    filter1.frequency.linearRampToValueAtTime(220, now + 0.9);
    filter1.frequency.linearRampToValueAtTime(145, now + 1.8);
    filter1.frequency.linearRampToValueAtTime(95, now + durationSec);

    const filter2 = ctx.createBiquadFilter();
    filter2.type = "lowpass";
    filter2.Q.value = 0.8;
    filter2.frequency.setValueAtTime(360, now);
    filter2.frequency.linearRampToValueAtTime(160, now + durationSec);

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.01, now);
    masterGain.gain.linearRampToValueAtTime(0.62 * scale, now + 0.12);
    masterGain.gain.linearRampToValueAtTime(0.48 * scale, now + 0.95);
    masterGain.gain.linearRampToValueAtTime(0.34 * scale, now + 1.9);
    masterGain.gain.exponentialRampToValueAtTime(0.001, now + durationSec);

    // Audible low-mid + sub thunder boom (50–115 Hz)
    const subOsc = ctx.createOscillator();
    const subGain = ctx.createGain();
    subOsc.type = "triangle";
    subOsc.frequency.setValueAtTime(112, now);
    subOsc.frequency.linearRampToValueAtTime(58, now + 0.55);
    subOsc.frequency.linearRampToValueAtTime(74, now + 0.95);
    subOsc.frequency.linearRampToValueAtTime(46, now + 2.6);

    const subFilter = ctx.createBiquadFilter();
    subFilter.type = "lowpass";
    subFilter.frequency.value = 160;

    subGain.gain.setValueAtTime(0.001, now);
    subGain.gain.linearRampToValueAtTime(0.32 * scale, now + 0.15);
    subGain.gain.linearRampToValueAtTime(0.24 * scale, now + 0.9);
    subGain.gain.linearRampToValueAtTime(0.16 * scale, now + 1.8);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 2.8);

    noise.connect(filter1);
    filter1.connect(filter2);
    filter2.connect(masterGain);
    masterGain.connect(ctx.destination);

    subOsc.connect(subFilter);
    subFilter.connect(subGain);
    subGain.connect(ctx.destination);

    noise.start(now);
    noise.stop(now + durationSec);
    subOsc.start(now);
    subOsc.stop(now + 2.85);
  }

  /**
   * Plays an authentic NASA Apollo/Artemis Quindar radio beep (2525 Hz / 2475 Hz)
   * and telemetry chime on spaceflight phase transitions so deep space feels alive.
   */
  public playSpaceTelemetryCue(kind: "burn_start" | "coast" | "lunar_flyby" | "entry" = "coast"): void {
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    const quindar = ctx.createOscillator();
    const qGain = ctx.createGain();
    quindar.type = "sine";
    quindar.frequency.setValueAtTime(kind === "burn_start" ? 2525 : 2475, now);
    qGain.gain.setValueAtTime(0.095, now);
    qGain.gain.setValueAtTime(0.095, now + 0.11);
    qGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

    quindar.connect(qGain);
    qGain.connect(ctx.destination);
    quindar.start(now);
    quindar.stop(now + 0.16);

    const notes =
      kind === "burn_start"
        ? [587.33, 880.0]
        : kind === "lunar_flyby"
          ? [523.25, 659.25, 987.77]
          : kind === "entry"
            ? [440.0, 349.23]
            : [659.25, 783.99];

    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t0 = now + 0.17 + idx * 0.08;

      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(0.11, t0);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.16);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.17);
    });
  }

  /** Plays a parachute canopy deployment thump when main chutes open. */
  public playParachuteDeploy(): void {
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "triangle";
    osc.frequency.setValueAtTime(145, now);
    osc.frequency.exponentialRampToValueAtTime(52, now + 0.42);

    gain.gain.setValueAtTime(0.32, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.46);
  }

  /** Subtle UI click for navigation and buttons. */
  public playClick(): void {
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(440, now + 0.045);

    gain.gain.setValueAtTime(0.14, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.05);
  }

  /** Mechanical latch sound when snapping/removing spacecraft parts in the Workshop. */
  public playPartSnap(added: boolean = true): void {
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "triangle";
    const startFreq = added ? 320 : 520;
    const endFreq = added ? 680 : 240;
    osc1.frequency.setValueAtTime(startFreq, now);
    osc1.frequency.exponentialRampToValueAtTime(endFreq, now + 0.09);

    gain1.gain.setValueAtTime(0.22, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.095);

    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.1);

    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(added ? 1020 : 380, now + 0.03);
    gain2.gain.setValueAtTime(0.09, now + 0.03);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.03);
    osc2.stop(now + 0.125);
  }

  /** Smooth frequency sweep when switching between LEO, SSO, GEO or Lunar Polar orbits. */
  public playOrbitSelect(): void {
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(260, now);
    osc.frequency.exponentialRampToValueAtTime(580, now + 0.16);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.14, now + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.19);
  }

  /** Validation sound when checking if spacecraft mass and orbit fit the chosen launch vehicle. */
  public playRocketCheck(fits: boolean): void {
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const notes = fits ? [523.25, 659.25] : [220, 185];

    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t0 = now + idx * 0.09;

      osc.type = fits ? "sine" : "triangle";
      osc.frequency.setValueAtTime(freq, t0);

      gain.gain.setValueAtTime(fits ? 0.15 : 0.14, t0);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.14);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(t0);
      osc.stop(t0 + 0.15);
    });
  }

  /** Countdown telemetry beep before rocket ignition. */
  public playCountdownBeep(isLiftoff: boolean = false): void {
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(isLiftoff ? 1046.5 : 659.25, now);

    const dur = isLiftoff ? 0.28 : 0.1;
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + dur + 0.01);
  }

  /**
   * Synthesizes a multi-layered rocket engine ignition and ascent rumble (for standalone Launch.tsx).
   */
  public playLaunchRumbling(durationSec: number = 4.2): () => void {
    if (this.activeLaunchStop) {
      this.activeLaunchStop();
      this.activeLaunchStop = null;
    }

    const ctx = this.getContext();
    if (!ctx) return () => {};

    const now = ctx.currentTime;
    const sampleRate = ctx.sampleRate;
    const frameCount = Math.max(1, Math.floor(sampleRate * durationSec));
    const buffer = ctx.createBuffer(1, frameCount, sampleRate);
    const data = buffer.getChannelData(0);

    let b0 = 0.0;
    let peak = 0.001;
    for (let i = 0; i < frameCount; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.945 * b0 + 0.055 * white;
      const sample = Math.tanh(b0 * 5.0);
      data[i] = sample;
      const abs = Math.abs(sample);
      if (abs > peak) peak = abs;
    }
    const norm = 0.92 / peak;
    for (let i = 0; i < frameCount; i++) {
      data[i] *= norm;
    }

    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = buffer;

    const filter1 = ctx.createBiquadFilter();
    filter1.type = "lowpass";
    filter1.frequency.setValueAtTime(190, now);
    filter1.frequency.exponentialRampToValueAtTime(280, now + durationSec * 0.45);
    filter1.frequency.exponentialRampToValueAtTime(210, now + durationSec);

    const filter2 = ctx.createBiquadFilter();
    filter2.type = "lowpass";
    filter2.frequency.setValueAtTime(290, now);

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.001, now);
    noiseGain.gain.linearRampToValueAtTime(0.58, now + 0.45);
    noiseGain.gain.setValueAtTime(0.58, now + Math.max(0.5, durationSec - 0.8));
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + durationSec);

    const subOsc = ctx.createOscillator();
    const subGain = ctx.createGain();
    subOsc.type = "triangle";
    subOsc.frequency.setValueAtTime(65, now);
    subOsc.frequency.linearRampToValueAtTime(98, now + durationSec);

    subGain.gain.setValueAtTime(0.001, now);
    subGain.gain.linearRampToValueAtTime(0.24, now + 0.35);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + durationSec);

    noiseSource.connect(filter1);
    filter1.connect(filter2);
    filter2.connect(noiseGain);
    noiseGain.connect(ctx.destination);

    subOsc.connect(subGain);
    subGain.connect(ctx.destination);

    noiseSource.start(now);
    noiseSource.stop(now + durationSec);
    subOsc.start(now);
    subOsc.stop(now + durationSec);

    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      try {
        noiseSource.stop();
        subOsc.stop();
      } catch {
        // Already stopped
      }
      if (this.activeLaunchStop === stop) {
        this.activeLaunchStop = null;
      }
    };

    this.activeLaunchStop = stop;
    return stop;
  }

  /** Plays an in-flight warning sound for Mission Control random events. */
  public playAlert(type: AlertSoundType = "solar_storm"): void {
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    if (type === "solar_storm" || type === "debris") {
      const freqs = type === "solar_storm" ? [740, 554.37, 740] : [880, 622.25, 880];
      freqs.forEach((f, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const t0 = now + idx * 0.11;

        osc.type = "triangle";
        osc.frequency.setValueAtTime(f, t0);

        gain.gain.setValueAtTime(0.16, t0);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.1);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + 0.105);
      });
      return;
    }

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(310, now);
    osc.frequency.linearRampToValueAtTime(195, now + 0.24);

    gain.gain.setValueAtTime(0.16, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.26);
  }

  /** Telemetry packet chirp when transmitting data over a ground station. */
  public playDownlinkBeep(): void {
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const notes = [1174.66, 1567.98, 1975.53];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t0 = now + idx * 0.045;

      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, t0);

      gain.gain.setValueAtTime(0.09, t0);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.04);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.045);
    });
  }

  /** Soft radar ping when detecting an active wildfire (FIRMS) or lunar polar ice target. */
  public playTargetDetected(): void {
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(1318.51, now);

    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.17);
  }

  /** End-of-mission fanfare (success) or power-down cadence (failure). */
  public playMissionResult(passed: boolean, stars: 1 | 2 | 3 = 3): void {
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const chord = passed
      ? stars === 3
        ? [523.25, 659.25, 783.99, 1046.5]
        : [523.25, 659.25, 783.99]
      : [392.0, 349.23, 311.13, 261.63];

    chord.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t0 = now + idx * 0.11;
      const dur = idx === chord.length - 1 ? 0.45 : 0.22;

      osc.type = passed ? "triangle" : "sine";
      osc.frequency.setValueAtTime(freq, t0);

      gain.gain.setValueAtTime(passed ? 0.18 : 0.15, t0);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    });
  }
}

export const soundManager = new SoundManager();

export const isMuted = () => soundManager.isMuted();
export const setMuted = (muted: boolean) => soundManager.setMuted(muted);
export const toggleMute = () => soundManager.toggleMute();
export const subscribeMute = (listener: MuteListener) => soundManager.subscribe(listener);
export const playClick = () => soundManager.playClick();
export const playPartSnap = (added?: boolean) => soundManager.playPartSnap(added);
export const playOrbitSelect = () => soundManager.playOrbitSelect();
export const playRocketCheck = (fits: boolean) => soundManager.playRocketCheck(fits);
export const playCountdownBeep = (isLiftoff?: boolean) => soundManager.playCountdownBeep(isLiftoff);
export const playLaunchRumbling = (durationSec?: number) => soundManager.playLaunchRumbling(durationSec);
export const updateFlightAudio = (params: FlightAudioParams) => soundManager.updateFlightAudio(params);
export const stopFlightAudio = () => soundManager.stopFlightAudio();
export const playThunderStrike = (intensity?: number) => soundManager.playThunderStrike(intensity);
export const playSpaceTelemetryCue = (kind?: "burn_start" | "coast" | "lunar_flyby" | "entry") =>
  soundManager.playSpaceTelemetryCue(kind);
export const playParachuteDeploy = () => soundManager.playParachuteDeploy();
export const playAlert = (type?: AlertSoundType) => soundManager.playAlert(type);
export const playDownlinkBeep = () => soundManager.playDownlinkBeep();
export const playTargetDetected = () => soundManager.playTargetDetected();
export const playMissionResult = (passed: boolean, stars?: 1 | 2 | 3) =>
  soundManager.playMissionResult(passed, stars);

export default soundManager;
