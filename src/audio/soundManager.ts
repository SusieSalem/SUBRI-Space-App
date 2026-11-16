// Procedural Web Audio API sound effects, spatial thunder, ambient space music,
// NASA voice callouts, and continuous flight audio engine (Role 4).
// Uses zero external audio files so it works offline with 0 KB asset overhead.

export type AlertSoundType =
  | "solar_storm"
  | "debris"
  | "memory_full"
  | "failure"
  | "station_outage";

export type StagePieceSound =
  | "boosters"
  | "stage1"
  | "stage2"
  | "escapeTower"
  | "serviceModule";

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

export interface AudioSettingsState {
  muted: boolean;
  volume: number;
  musicEnabled: boolean;
  voiceEnabled: boolean;
}

type MuteListener = (muted: boolean) => void;
type SettingsListener = (state: AudioSettingsState) => void;

const STORAGE_KEY_MUTED = "mission_architect_muted";
const STORAGE_KEY_VOLUME = "mission_architect_volume";
const STORAGE_KEY_MUSIC = "mission_architect_music";
const STORAGE_KEY_VOICE = "mission_architect_voice";

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

interface MusicNodes {
  oscs: OscillatorNode[];
  lfo: OscillatorNode;
  filter: BiquadFilterNode;
  gain: GainNode;
  chordTimer: number;
}

class SoundManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private muted: boolean = false;
  private volume: number = 0.8;
  private musicEnabled: boolean = false;
  private voiceEnabled: boolean = true;
  private tabHidden: boolean = false;

  private listeners: Set<MuteListener> = new Set();
  private settingsListeners: Set<SettingsListener> = new Set();
  private activeLaunchStop: (() => void) | null = null;
  private loopNodes: ContinuousLoopNodes | null = null;
  private musicNodes: MusicNodes | null = null;
  private lastThunderAt: number = 0;
  private lastFlightUpdateMs: number = 0;

  constructor() {
    if (typeof window !== "undefined") {
      try {
        this.muted = window.localStorage.getItem(STORAGE_KEY_MUTED) === "true";
        const savedVol = parseFloat(window.localStorage.getItem(STORAGE_KEY_VOLUME) ?? "0.8");
        if (!Number.isNaN(savedVol)) {
          this.volume = Math.max(0, Math.min(1, savedVol));
        }
        const savedMusic = window.localStorage.getItem(STORAGE_KEY_MUSIC);
        if (savedMusic !== null) this.musicEnabled = savedMusic === "true";
        const savedVoice = window.localStorage.getItem(STORAGE_KEY_VOICE);
        if (savedVoice !== null) this.voiceEnabled = savedVoice === "true";
      } catch {
        // Ignore storage errors
      }

      // #10: Auto-suspend audio & voice when the browser tab loses visibility
      document.addEventListener("visibilitychange", () => {
        this.tabHidden = document.hidden;
        if (this.tabHidden) {
          this.ctx?.suspend().catch(() => {});
          if ("speechSynthesis" in window) {
            window.speechSynthesis.cancel();
          }
        } else if (!this.muted && this.ctx && this.ctx.state === "suspended") {
          this.ctx.resume().catch(() => {});
        }
      });
    }
  }

  private getContext(): AudioContext | null {
    if (this.muted || this.tabHidden || typeof window === "undefined") return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : this.volume;
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended" && !this.tabHidden) {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private getDestination(): AudioNode | null {
    const ctx = this.getContext();
    if (!ctx) return null;
    if (!this.masterGain) {
      this.masterGain = ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : this.volume;
      this.masterGain.connect(ctx.destination);
    }
    return this.masterGain;
  }

  private notifyListeners(): void {
    const state = this.getSettings();
    this.listeners.forEach((fn) => fn(this.muted));
    this.settingsListeners.forEach((fn) => fn(state));
  }

  public getSettings(): AudioSettingsState {
    return {
      muted: this.muted,
      volume: this.volume,
      musicEnabled: this.musicEnabled,
      voiceEnabled: this.voiceEnabled,
    };
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public setMuted(value: boolean): boolean {
    this.muted = value;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(value ? 0 : this.volume, this.ctx.currentTime, 0.04);
    }
    if (value) {
      if (this.activeLaunchStop) {
        this.activeLaunchStop();
        this.activeLaunchStop = null;
      }
      this.stopFlightAudio();
      this.stopMusicNodes();
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    } else if (this.musicEnabled) {
      this.startMusicNodes();
    }
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(STORAGE_KEY_MUTED, String(value));
      } catch {
        // Ignore storage errors
      }
    }
    this.notifyListeners();
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

  public getVolume(): number {
    return this.volume;
  }

  public setVolume(val: number): number {
    this.volume = Math.max(0, Math.min(1, val));
    if (this.volume > 0 && this.muted) {
      this.muted = false;
      try {
        window.localStorage.setItem(STORAGE_KEY_MUTED, "false");
      } catch {
        // Ignore
      }
    }
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(
        this.muted ? 0 : this.volume,
        this.ctx.currentTime,
        0.03,
      );
    }
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(STORAGE_KEY_VOLUME, String(this.volume));
      } catch {
        // Ignore
      }
    }
    this.notifyListeners();
    return this.volume;
  }

  public isMusicEnabled(): boolean {
    return this.musicEnabled;
  }

  public setMusicEnabled(enabled: boolean): boolean {
    this.musicEnabled = enabled;
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(STORAGE_KEY_MUSIC, String(enabled));
      } catch {
        // Ignore
      }
    }
    if (enabled && !this.muted) {
      this.startMusicNodes();
    } else {
      this.stopMusicNodes();
    }
    this.notifyListeners();
    return this.musicEnabled;
  }

  public toggleMusic(): boolean {
    return this.setMusicEnabled(!this.musicEnabled);
  }

  public isVoiceEnabled(): boolean {
    return this.voiceEnabled;
  }

  public setVoiceEnabled(enabled: boolean): boolean {
    this.voiceEnabled = enabled;
    if (!enabled && typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(STORAGE_KEY_VOICE, String(enabled));
      } catch {
        // Ignore
      }
    }
    this.notifyListeners();
    return this.voiceEnabled;
  }

  public toggleVoice(): boolean {
    const next = !this.voiceEnabled;
    this.setVoiceEnabled(next);
    if (next) {
      this.speakCallout("Telemetry voice online");
    }
    return next;
  }

  public subscribe(listener: MuteListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public subscribeSettings(listener: SettingsListener): () => void {
    this.settingsListeners.add(listener);
    return () => {
      this.settingsListeners.delete(listener);
    };
  }

  // ---------------------------------------------------------------------------
  // #2: Procedural Ambient Space Music Pad (warm evolving chord progression)
  // ---------------------------------------------------------------------------
  private startMusicNodes(): void {
    if (this.musicNodes || this.muted) return;
    const ctx = this.getContext();
    const dest = this.getDestination();
    if (!ctx || !dest) return;

    const chords: [number, number, number, number][] = [
      [130.81, 196.0, 246.94, 293.66], // Cmaj9 (C3, G3, B3, D4)
      [110.0, 164.81, 220.0, 261.63],  // Am7   (A2, E3, A3, C4)
      [87.31, 130.81, 174.61, 220.0],  // Fmaj7 (F2, C3, F3, A3)
      [98.0, 146.83, 196.0, 246.94],   // G6    (G2, D3, G3, B3)
    ];

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 340;
    filter.Q.value = 0.7;

    // Slow LFO breathing on the pad filter
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.type = "sine";
    lfo.frequency.value = 0.12;
    lfoGain.gain.value = 110;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.055, ctx.currentTime + 1.8);

    const oscs: OscillatorNode[] = [];
    chords[0].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = i % 2 === 0 ? "sine" : "triangle";
      osc.frequency.value = freq;
      osc.detune.value = (i - 1.5) * 4;
      osc.connect(filter);
      osc.start(ctx.currentTime);
      oscs.push(osc);
    });

    lfo.start(ctx.currentTime);
    filter.connect(gain);
    gain.connect(dest);

    let chordIdx = 0;
    const chordTimer = window.setInterval(() => {
      if (!this.ctx || this.muted || !this.musicEnabled) return;
      chordIdx = (chordIdx + 1) % chords.length;
      const nextChord = chords[chordIdx];
      const tNow = this.ctx.currentTime;
      oscs.forEach((osc, idx) => {
        osc.frequency.setTargetAtTime(nextChord[idx], tNow, 1.4);
      });
    }, 8000);

    this.musicNodes = { oscs, lfo, filter, gain, chordTimer };
  }

  private stopMusicNodes(): void {
    if (!this.musicNodes) return;
    window.clearInterval(this.musicNodes.chordTimer);
    try {
      this.musicNodes.oscs.forEach((o) => o.stop());
      this.musicNodes.lfo.stop();
      this.musicNodes.gain.disconnect();
    } catch {
      // Ignore
    }
    this.musicNodes = null;
  }

  // ---------------------------------------------------------------------------
  // #5: Mission Control Voice Callouts (Web Speech API)
  // ---------------------------------------------------------------------------
  public speakCallout(text: string): void {
    if (this.muted || !this.voiceEnabled || this.tabHidden || typeof window === "undefined") return;
    if (!("speechSynthesis" in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = "en-US";
      utter.rate = 1.06;
      utter.pitch = 0.96;
      utter.volume = Math.max(0.15, Math.min(1, this.volume * 0.85));
      window.speechSynthesis.speak(utter);
    } catch {
      // Ignore speech synthesis errors on unsupported browsers
    }
  }

  // ---------------------------------------------------------------------------
  // Continuous Flight, Engine, Rain & Space Cabin Loop
  // ---------------------------------------------------------------------------
  private ensureLoopNodes(ctx: AudioContext): ContinuousLoopNodes {
    if (this.loopNodes) return this.loopNodes;
    const dest = this.getDestination() ?? ctx.destination;

    const durationSec = 6.0;
    const sampleRate = ctx.sampleRate;
    const frameCount = Math.floor(sampleRate * durationSec);
    const fadeSamples = Math.floor(sampleRate * 0.2);

    // 1. Engine Thrust Buffer: Warm saturated brown noise with strong 70–280 Hz body
    const engineBuffer = ctx.createBuffer(1, frameCount, sampleRate);
    const engineData = engineBuffer.getChannelData(0);
    let e0 = 0.0;
    let ePeak = 0.001;
    for (let i = 0; i < frameCount; i++) {
      const t = i / sampleRate;
      const white = Math.random() * 2 - 1;
      e0 = 0.945 * e0 + 0.055 * white;
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

    // 2. Dedicated Rain & Wind Patter Buffer
    const rainBuffer = ctx.createBuffer(1, frameCount, sampleRate);
    const rainData = rainBuffer.getChannelData(0);
    let r0 = 0.0;
    let r1 = 0.0;
    let dropEnv = 0.0;
    let rPeak = 0.001;
    for (let i = 0; i < frameCount; i++) {
      const t = i / sampleRate;
      const white = Math.random() * 2 - 1;
      r0 = 0.91 * r0 + 0.09 * white;
      r1 = 0.78 * r1 + 0.22 * r0;

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

    const rainHighpass = ctx.createBiquadFilter();
    rainHighpass.type = "highpass";
    rainHighpass.frequency.value = 175;

    const rainLowpass = ctx.createBiquadFilter();
    rainLowpass.type = "lowpass";
    rainLowpass.frequency.value = 480;

    const rainGain = ctx.createGain();
    rainGain.gain.value = 0.0001;

    // 3. Deep-Space Spacecraft Cabin & Gyro Ambience (> 80 km)
    const spaceOsc1 = ctx.createOscillator();
    spaceOsc1.type = "sine";
    spaceOsc1.frequency.value = 110.0;
    const spaceOsc2 = ctx.createOscillator();
    spaceOsc2.type = "sine";
    spaceOsc2.frequency.value = 164.81;
    const spaceGain = ctx.createGain();
    spaceGain.gain.value = 0.0001;

    engineSource.connect(engineFilter1);
    engineFilter1.connect(engineFilter2);
    engineFilter2.connect(engineNoiseGain);
    engineNoiseGain.connect(dest);

    subOsc1.connect(subFilter);
    subOsc2.connect(subFilter);
    subOsc3.connect(subFilter);
    subFilter.connect(subGain);
    subGain.connect(dest);

    rainSource.connect(rainHighpass);
    rainHighpass.connect(rainLowpass);
    rainLowpass.connect(rainGain);
    rainGain.connect(dest);

    spaceOsc1.connect(spaceGain);
    spaceOsc2.connect(spaceGain);
    spaceGain.connect(dest);

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
   * #9: Throttled to 20 Hz (every 50 ms) so high-warp flight and school-grade laptops
   * experience zero main-thread WebAudio parameter congestion.
   */
  public updateFlightAudio(params: FlightAudioParams): void {
    if (this.muted || this.tabHidden) return;
    const nowPerf = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (nowPerf - this.lastFlightUpdateMs < 48) return;
    this.lastFlightUpdateMs = nowPerf;

    const ctx = this.getContext();
    if (!ctx || ctx.state !== "running") return;

    if (this.musicEnabled && !this.musicNodes) {
      this.startMusicNodes();
    }

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
        const altFactor = Math.max(0.65, Math.exp(-Math.max(0, altitudeM) / 120000));
        targetNoiseGain = 0.68 * altFactor * effThrottle;
        targetCutoff1 = 195 + 85 * altFactor;
        targetCutoff2 = 240 + 95 * altFactor;
        targetSubGain = 0.28 * effThrottle;
        targetFreq1 = 52 + 10 * effThrottle;
        targetFreq2 = 104 + 18 * effThrottle;
        targetFreq3 = 156 + 24 * effThrottle;
      } else if (burningS2) {
        targetNoiseGain = 0.44 * effThrottle;
        targetCutoff1 = 185;
        targetCutoff2 = 230;
        targetSubGain = 0.24 * effThrottle;
        targetFreq1 = 62 + 8 * effThrottle;
        targetFreq2 = 124 + 16 * effThrottle;
        targetFreq3 = 186 + 22 * effThrottle;
      } else if (burningService) {
        targetNoiseGain = 0.36 * effThrottle;
        targetCutoff1 = 175;
        targetCutoff2 = 215;
        targetSubGain = 0.22 * effThrottle;
        targetFreq1 = 68 + 8 * effThrottle;
        targetFreq2 = 136 + 14 * effThrottle;
        targetFreq3 = 204 + 20 * effThrottle;
      }
    }

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

    const inSpace = active && flying && altitudeM > 80000;
    const targetSpaceGain = inSpace ? 0.038 : 0.0001;
    nodes.spaceGain.gain.setTargetAtTime(targetSpaceGain, now, 0.25);
  }

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

  // ---------------------------------------------------------------------------
  // #3: Heavy Pyrotechnic Stage Separation Sound (Boosters / Stage 1 / Fairing)
  // ---------------------------------------------------------------------------
  public playStageSeparation(piece: StagePieceSound = "stage1"): void {
    const ctx = this.getContext();
    const dest = this.getDestination();
    if (!ctx || !dest) return;

    const now = ctx.currentTime;

    // 1. Deep pyrotechnic bolt thump (low-end punch)
    const thumpOsc = ctx.createOscillator();
    const thumpGain = ctx.createGain();
    thumpOsc.type = "sine";
    const startHz = piece === "boosters" || piece === "stage1" ? 135 : 175;
    thumpOsc.frequency.setValueAtTime(startHz, now);
    thumpOsc.frequency.exponentialRampToValueAtTime(34, now + 0.32);

    thumpGain.gain.setValueAtTime(0.42, now);
    thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.34);

    thumpOsc.connect(thumpGain);
    thumpGain.connect(dest);
    thumpOsc.start(now);
    thumpOsc.stop(now + 0.35);

    // 2. Pneumatic pusher release burst (filtered warm burst)
    const dur = 0.26;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      b = 0.88 * b + 0.12 * white;
      data[i] = b * Math.exp(-(i / len) * 4.5);
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buf;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(360, now);
    filter.frequency.exponentialRampToValueAtTime(110, now + dur);

    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(0.32, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    noise.connect(filter);
    filter.connect(nGain);
    nGain.connect(dest);
    noise.start(now);
    noise.stop(now + dur);

    // 3. Mechanical clamp ring
    const ringOsc = ctx.createOscillator();
    const ringGain = ctx.createGain();
    ringOsc.type = "triangle";
    ringOsc.frequency.setValueAtTime(piece === "escapeTower" ? 580 : 420, now + 0.02);
    ringOsc.frequency.exponentialRampToValueAtTime(190, now + 0.18);
    ringGain.gain.setValueAtTime(0.18, now + 0.02);
    ringGain.gain.exponentialRampToValueAtTime(0.001, now + 0.19);

    ringOsc.connect(ringGain);
    ringGain.connect(dest);
    ringOsc.start(now + 0.02);
    ringOsc.stop(now + 0.2);
  }

  // ---------------------------------------------------------------------------
  // #4: Spatial Stereo Panned & Distance-Delayed Rolling Thunder
  // ---------------------------------------------------------------------------
  public playThunderStrike(
    intensity: number = 0.85,
    pan: number = 0,
    delaySec: number = 0,
  ): void {
    const ctx = this.getContext();
    const dest = this.getDestination();
    if (!ctx || !dest) return;

    const now = ctx.currentTime;
    if (now - this.lastThunderAt < 1.25) return;
    this.lastThunderAt = now;

    const startAt = now + Math.max(0, Math.min(1.2, delaySec));
    const scale = Math.max(0.3, Math.min(1.0, intensity));
    const durationSec = 3.8;
    const sampleRate = ctx.sampleRate;
    const frameCount = Math.floor(sampleRate * durationSec);
    const buffer = ctx.createBuffer(1, frameCount, sampleRate);
    const data = buffer.getChannelData(0);

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
    filter1.frequency.setValueAtTime(320, startAt);
    filter1.frequency.linearRampToValueAtTime(185, startAt + 0.5);
    filter1.frequency.linearRampToValueAtTime(220, startAt + 0.9);
    filter1.frequency.linearRampToValueAtTime(145, startAt + 1.8);
    filter1.frequency.linearRampToValueAtTime(95, startAt + durationSec);

    const filter2 = ctx.createBiquadFilter();
    filter2.type = "lowpass";
    filter2.Q.value = 0.8;
    filter2.frequency.setValueAtTime(360, startAt);
    filter2.frequency.linearRampToValueAtTime(160, startAt + durationSec);

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.01, startAt);
    masterGain.gain.linearRampToValueAtTime(0.62 * scale, startAt + 0.12);
    masterGain.gain.linearRampToValueAtTime(0.48 * scale, startAt + 0.95);
    masterGain.gain.linearRampToValueAtTime(0.34 * scale, startAt + 1.9);
    masterGain.gain.exponentialRampToValueAtTime(0.001, startAt + durationSec);

    const subOsc = ctx.createOscillator();
    const subGain = ctx.createGain();
    subOsc.type = "triangle";
    subOsc.frequency.setValueAtTime(112, startAt);
    subOsc.frequency.linearRampToValueAtTime(58, startAt + 0.55);
    subOsc.frequency.linearRampToValueAtTime(74, startAt + 0.95);
    subOsc.frequency.linearRampToValueAtTime(46, startAt + 2.6);

    const subFilter = ctx.createBiquadFilter();
    subFilter.type = "lowpass";
    subFilter.frequency.value = 160;

    subGain.gain.setValueAtTime(0.001, startAt);
    subGain.gain.linearRampToValueAtTime(0.32 * scale, startAt + 0.15);
    subGain.gain.linearRampToValueAtTime(0.24 * scale, startAt + 0.9);
    subGain.gain.linearRampToValueAtTime(0.16 * scale, startAt + 1.8);
    subGain.gain.exponentialRampToValueAtTime(0.001, startAt + 2.8);

    // Optional StereoPannerNode for directional thunder
    let outNode: AudioNode = dest;
    if ("createStereoPanner" in ctx) {
      const panner = ctx.createStereoPanner();
      panner.pan.setValueAtTime(Math.max(-0.85, Math.min(0.85, pan)), startAt);
      panner.connect(dest);
      outNode = panner;
    }

    noise.connect(filter1);
    filter1.connect(filter2);
    filter2.connect(masterGain);
    masterGain.connect(outNode);

    subOsc.connect(subFilter);
    subFilter.connect(subGain);
    subGain.connect(outNode);

    noise.start(startAt);
    noise.stop(startAt + durationSec);
    subOsc.start(startAt);
    subOsc.stop(startAt + 2.85);
  }

  public playSpaceTelemetryCue(kind: "burn_start" | "coast" | "lunar_flyby" | "entry" = "coast"): void {
    const ctx = this.getContext();
    const dest = this.getDestination();
    if (!ctx || !dest) return;

    const now = ctx.currentTime;

    const quindar = ctx.createOscillator();
    const qGain = ctx.createGain();
    quindar.type = "sine";
    quindar.frequency.setValueAtTime(kind === "burn_start" ? 2525 : 2475, now);
    qGain.gain.setValueAtTime(0.095, now);
    qGain.gain.setValueAtTime(0.095, now + 0.11);
    qGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

    quindar.connect(qGain);
    qGain.connect(dest);
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
      gain.connect(dest);
      osc.start(t0);
      osc.stop(t0 + 0.17);
    });
  }

  public playParachuteDeploy(): void {
    const ctx = this.getContext();
    const dest = this.getDestination();
    if (!ctx || !dest) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "triangle";
    osc.frequency.setValueAtTime(145, now);
    osc.frequency.exponentialRampToValueAtTime(52, now + 0.42);

    gain.gain.setValueAtTime(0.32, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

    osc.connect(gain);
    gain.connect(dest);

    osc.start(now);
    osc.stop(now + 0.46);
  }

  public playClick(): void {
    const ctx = this.getContext();
    const dest = this.getDestination();
    if (!ctx || !dest) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(440, now + 0.045);

    gain.gain.setValueAtTime(0.14, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);

    osc.connect(gain);
    gain.connect(dest);

    osc.start(now);
    osc.stop(now + 0.05);
  }

  public playPartSnap(added: boolean = true): void {
    const ctx = this.getContext();
    const dest = this.getDestination();
    if (!ctx || !dest) return;

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
    gain1.connect(dest);
    osc1.start(now);
    osc1.stop(now + 0.1);

    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(added ? 1020 : 380, now + 0.03);
    gain2.gain.setValueAtTime(0.09, now + 0.03);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

    osc2.connect(gain2);
    gain2.connect(dest);
    osc2.start(now + 0.03);
    osc2.stop(now + 0.125);
  }

  public playOrbitSelect(): void {
    const ctx = this.getContext();
    const dest = this.getDestination();
    if (!ctx || !dest) return;

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
    gain.connect(dest);

    osc.start(now);
    osc.stop(now + 0.19);
  }

  public playRocketCheck(fits: boolean): void {
    const ctx = this.getContext();
    const dest = this.getDestination();
    if (!ctx || !dest) return;

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
      gain.connect(dest);

      osc.start(t0);
      osc.stop(t0 + 0.15);
    });
  }

  public playCountdownBeep(isLiftoff: boolean = false): void {
    const ctx = this.getContext();
    const dest = this.getDestination();
    if (!ctx || !dest) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(isLiftoff ? 1046.5 : 659.25, now);

    const dur = isLiftoff ? 0.28 : 0.1;
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    osc.connect(gain);
    gain.connect(dest);

    osc.start(now);
    osc.stop(now + dur + 0.01);
  }

  public playLaunchRumbling(durationSec: number = 4.2): () => void {
    if (this.activeLaunchStop) {
      this.activeLaunchStop();
      this.activeLaunchStop = null;
    }

    const ctx = this.getContext();
    const dest = this.getDestination();
    if (!ctx || !dest) return () => {};

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
    noiseGain.connect(dest);

    subOsc.connect(subGain);
    subGain.connect(dest);

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

  public playAlert(type: AlertSoundType = "solar_storm"): void {
    const ctx = this.getContext();
    const dest = this.getDestination();
    if (!ctx || !dest) return;

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
        gain.connect(dest);
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
    gain.connect(dest);
    osc.start(now);
    osc.stop(now + 0.26);
  }

  public playDownlinkBeep(): void {
    const ctx = this.getContext();
    const dest = this.getDestination();
    if (!ctx || !dest) return;

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
      gain.connect(dest);
      osc.start(t0);
      osc.stop(t0 + 0.045);
    });
  }

  public playTargetDetected(): void {
    const ctx = this.getContext();
    const dest = this.getDestination();
    if (!ctx || !dest) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(1318.51, now);

    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

    osc.connect(gain);
    gain.connect(dest);
    osc.start(now);
    osc.stop(now + 0.17);
  }

  public playMissionResult(passed: boolean, stars: 1 | 2 | 3 = 3): void {
    const ctx = this.getContext();
    const dest = this.getDestination();
    if (!ctx || !dest) return;

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
      gain.connect(dest);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    });
  }
}

export const soundManager = new SoundManager();

export const isMuted = () => soundManager.isMuted();
export const setMuted = (muted: boolean) => soundManager.setMuted(muted);
export const toggleMute = () => soundManager.toggleMute();
export const getVolume = () => soundManager.getVolume();
export const setVolume = (vol: number) => soundManager.setVolume(vol);
export const isMusicEnabled = () => soundManager.isMusicEnabled();
export const toggleMusic = () => soundManager.toggleMusic();
export const isVoiceEnabled = () => soundManager.isVoiceEnabled();
export const toggleVoice = () => soundManager.toggleVoice();
export const getAudioSettings = () => soundManager.getSettings();
export const subscribeMute = (listener: MuteListener) => soundManager.subscribe(listener);
export const subscribeAudioSettings = (listener: SettingsListener) =>
  soundManager.subscribeSettings(listener);
export const speakCallout = (text: string) => soundManager.speakCallout(text);
export const playClick = () => soundManager.playClick();
export const playPartSnap = (added?: boolean) => soundManager.playPartSnap(added);
export const playStageSeparation = (piece?: StagePieceSound) =>
  soundManager.playStageSeparation(piece);
export const playOrbitSelect = () => soundManager.playOrbitSelect();
export const playRocketCheck = (fits: boolean) => soundManager.playRocketCheck(fits);
export const playCountdownBeep = (isLiftoff?: boolean) => soundManager.playCountdownBeep(isLiftoff);
export const playLaunchRumbling = (durationSec?: number) => soundManager.playLaunchRumbling(durationSec);
export const updateFlightAudio = (params: FlightAudioParams) => soundManager.updateFlightAudio(params);
export const stopFlightAudio = () => soundManager.stopFlightAudio();
export const playThunderStrike = (intensity?: number, pan?: number, delaySec?: number) =>
  soundManager.playThunderStrike(intensity, pan, delaySec);
export const playSpaceTelemetryCue = (kind?: "burn_start" | "coast" | "lunar_flyby" | "entry") =>
  soundManager.playSpaceTelemetryCue(kind);
export const playParachuteDeploy = () => soundManager.playParachuteDeploy();
export const playAlert = (type?: AlertSoundType) => soundManager.playAlert(type);
export const playDownlinkBeep = () => soundManager.playDownlinkBeep();
export const playTargetDetected = () => soundManager.playTargetDetected();
export const playMissionResult = (passed: boolean, stars?: 1 | 2 | 3) =>
  soundManager.playMissionResult(passed, stars);

export default soundManager;
