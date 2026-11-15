// Procedural Web Audio API sound effects manager for Mission Architect (Role 4).
// Uses zero external audio files so it works offline with 0 KB asset overhead.

export type AlertSoundType =
  | "solar_storm"
  | "debris"
  | "memory_full"
  | "failure"
  | "station_outage";

type MuteListener = (muted: boolean) => void;

const STORAGE_KEY = "mission_architect_muted";

class SoundManager {
  private ctx: AudioContext | null = null;
  private muted: boolean = false;
  private listeners: Set<MuteListener> = new Set();
  private activeLaunchStop: (() => void) | null = null;

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
    if (value && this.activeLaunchStop) {
      this.activeLaunchStop();
      this.activeLaunchStop = null;
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

    gain.gain.setValueAtTime(0.12, now);
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

    // 1. Metallic transient click
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "triangle";
    const startFreq = added ? 320 : 520;
    const endFreq = added ? 680 : 240;
    osc1.frequency.setValueAtTime(startFreq, now);
    osc1.frequency.exponentialRampToValueAtTime(endFreq, now + 0.09);

    gain1.gain.setValueAtTime(0.2, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.095);

    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.1);

    // 2. Pneumatic lock harmonic
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(added ? 1020 : 380, now + 0.03);
    gain2.gain.setValueAtTime(0.08, now + 0.03);
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
    gain.gain.linearRampToValueAtTime(0.12, now + 0.04);
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

      osc.type = fits ? "sine" : "sawtooth";
      osc.frequency.setValueAtTime(freq, t0);

      gain.gain.setValueAtTime(fits ? 0.14 : 0.1, t0);
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
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + dur + 0.01);
  }

  /**
   * Synthesizes a multi-layered rocket engine ignition and ascent rumble.
   * Returns a cleanup function to stop the rumble early if the user skips.
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

    // Generate brown-ish noise with crackle for rocket plume
    let lastOut = 0.0;
    for (let i = 0; i < frameCount; i++) {
      const white = Math.random() * 2 - 1;
      lastOut = (lastOut + 0.04 * white) / 1.04;
      data[i] = lastOut * 2.8;
    }

    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = buffer;

    // Low-pass filter that opens up as the rocket clears the tower
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(140, now);
    filter.frequency.exponentialRampToValueAtTime(420, now + durationSec * 0.45);
    filter.frequency.exponentialRampToValueAtTime(190, now + durationSec);

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.001, now);
    noiseGain.gain.linearRampToValueAtTime(0.32, now + 0.45);
    noiseGain.gain.setValueAtTime(0.32, now + Math.max(0.5, durationSec - 0.8));
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + durationSec);

    // Sub-bass engine resonance oscillator
    const subOsc = ctx.createOscillator();
    const subGain = ctx.createGain();
    subOsc.type = "sawtooth";
    subOsc.frequency.setValueAtTime(52, now);
    subOsc.frequency.linearRampToValueAtTime(78, now + durationSec);

    subGain.gain.setValueAtTime(0.001, now);
    subGain.gain.linearRampToValueAtTime(0.11, now + 0.35);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + durationSec);

    noiseSource.connect(filter);
    filter.connect(noiseGain);
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
      // Two-tone space warning klaxon
      const freqs = type === "solar_storm" ? [740, 554.37, 740] : [880, 622.25, 880];
      freqs.forEach((f, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const t0 = now + idx * 0.11;

        osc.type = "triangle";
        osc.frequency.setValueAtTime(f, t0);

        gain.gain.setValueAtTime(0.15, t0);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.1);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + 0.105);
      });
      return;
    }

    // Memory full / component failure / station outage warning buzz
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(310, now);
    osc.frequency.linearRampToValueAtTime(195, now + 0.24);

    gain.gain.setValueAtTime(0.13, now);
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

      gain.gain.setValueAtTime(0.08, t0);
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

    gain.gain.setValueAtTime(0.09, now);
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
        ? [523.25, 659.25, 783.99, 1046.5] // C5 - E5 - G5 - C6
        : [523.25, 659.25, 783.99]
      : [392.0, 349.23, 311.13, 261.63]; // Descending minor cadence

    chord.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t0 = now + idx * 0.11;
      const dur = idx === chord.length - 1 ? 0.45 : 0.22;

      osc.type = passed ? "triangle" : "sawtooth";
      osc.frequency.setValueAtTime(freq, t0);

      gain.gain.setValueAtTime(passed ? 0.16 : 0.11, t0);
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
export const playAlert = (type?: AlertSoundType) => soundManager.playAlert(type);
export const playDownlinkBeep = () => soundManager.playDownlinkBeep();
export const playTargetDetected = () => soundManager.playTargetDetected();
export const playMissionResult = (passed: boolean, stars?: 1 | 2 | 3) =>
  soundManager.playMissionResult(passed, stars);

export default soundManager;
