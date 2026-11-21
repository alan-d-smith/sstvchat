// Browser audio I/O for the radio: mic capture (AudioWorklet, ScriptProcessor fallback) and
// sample playback. Half duplex: mic chunks are dropped while transmitting and for a short guard
// after, so a device never decodes its own transmission.

export type RadioState = 'off' | 'starting' | 'listening' | 'transmitting' | 'denied' | 'error';

export interface AudioEngine {
  readonly sampleRate: number;
  state(): RadioState;
  start(): Promise<void>;
  onState(fn: (s: RadioState) => void): () => void;
  onSamples(fn: (chunk: Float32Array) => void): () => void; // mic; nothing while transmitting
  play(samples: Float32Array, onProgress?: (p: number) => void): { done: Promise<void>; stop(): void };
  /** What the browser actually gave us (for the diagnostics panel); null before the mic runs. */
  details?(): EngineDetails | null;
  /** Reopens the mic (e.g. another one was chosen); does nothing while it is off. */
  restart?(): Promise<void>;
}

export interface AudioEngineOptions {
  /** The chosen microphone's deviceId, read on every mic start; null/empty = the system default. */
  micId?: () => string | null;
}

/** Raw input for the modem: no echo cancellation, noise suppression or gain control. */
const MIC_CONSTRAINTS: MediaTrackConstraints = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 };

export interface EngineDetails {
  /** Mic track label and the settings actually applied (EC/NS/AGC, sample rate, device). */
  label: string;
  settings: MediaTrackSettings;
  trackState: MediaStreamTrackState | 'none';
  muted: boolean;
  contextRate: number;
  contextState: AudioContextState;
  capture: 'AudioWorklet' | 'ScriptProcessor' | 'none';
}

const CHUNK = 2048;
const TX_GUARD_MS = 150;
const PROGRESS_MS = 100;
const START_LEAD_S = 0.05;

// Posts the mic as mono Float32Array chunks of CHUNK samples (buffers are transferred, not copied).
const WORKLET_SOURCE = `
class SstvCapture extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(${CHUNK}); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = ch[i];
        if (this.n === this.buf.length) {
          this.port.postMessage(this.buf, [this.buf.buffer]);
          this.buf = new Float32Array(${CHUNK});
          this.n = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('sstv-capture', SstvCapture);
`;

type Ctor = typeof AudioContext;

function audioContextCtor(): Ctor | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.AudioContext ?? (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;
}

/** True when this browser can run the audio engine at all. */
export function hasWebAudio(): boolean {
  return audioContextCtor() !== undefined;
}

const isDenied = (e: unknown) =>
  e instanceof Error && ['NotAllowedError', 'SecurityError', 'PermissionDeniedError'].includes(e.name);

export function createAudioEngine(opts: AudioEngineOptions = {}): AudioEngine {
  let ctx: AudioContext | null = null;
  let mic: Exclude<RadioState, 'transmitting'> = 'off';
  let last: RadioState = 'off';
  let starting: Promise<void> | null = null;
  let playing = 0;
  let mutedUntil = 0;
  // Capture nodes and the stream are held here so they are not garbage collected.
  let graph: { stop(): void } | null = null;
  let track: MediaStreamTrack | null = null;
  let captureKind: EngineDetails['capture'] = 'none';

  const stateFns = new Set<(s: RadioState) => void>();
  const sampleFns = new Set<(c: Float32Array) => void>();

  const current = (): RadioState => (playing > 0 ? 'transmitting' : mic);
  const notify = () => {
    const s = current();
    if (s === last) return;
    last = s;
    for (const fn of [...stateFns]) fn(s);
  };

  // Created lazily so the context comes from a user gesture (autoplay policy) and StrictMode's
  // throwaway engines never open one.
  function ensureCtx(): AudioContext {
    if (ctx) return ctx;
    const C = audioContextCtor();
    if (!C) throw new Error('Web Audio is not available');
    ctx = new C({ latencyHint: 'interactive' });
    return ctx;
  }

  function resume(c: AudioContext) {
    if (c.state !== 'running') void c.resume().catch(() => {});
  }

  function deliver(chunk: Float32Array) {
    if (playing > 0 || performance.now() < mutedUntil) return;
    for (const fn of [...sampleFns]) {
      try {
        fn(chunk);
      } catch (e) {
        console.error('[radio] sample listener failed', e);
      }
    }
  }

  async function capture(c: AudioContext, stream: MediaStream) {
    const source = c.createMediaStreamSource(stream);
    // Capture nodes must reach the destination to be pulled; a muted gain keeps them silent.
    const sink = c.createGain();
    sink.gain.value = 0;
    sink.connect(c.destination);
    const stopTracks = () => stream.getTracks().forEach((t) => t.stop());

    if (c.audioWorklet && typeof AudioWorkletNode === 'function') {
      try {
        const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }));
        try {
          await c.audioWorklet.addModule(url);
        } finally {
          URL.revokeObjectURL(url);
        }
        const node = new AudioWorkletNode(c, 'sstv-capture', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [1],
          channelCount: 1,
          channelCountMode: 'explicit',
        });
        node.port.onmessage = (e: MessageEvent<Float32Array>) => deliver(e.data);
        source.connect(node);
        node.connect(sink);
        captureKind = 'AudioWorklet';
        graph = {
          stop() {
            node.port.onmessage = null;
            source.disconnect();
            node.disconnect();
            stopTracks();
          },
        };
        return;
      } catch (e) {
        console.warn('[radio] AudioWorklet unavailable, using ScriptProcessor', e);
      }
    }

    const proc = c.createScriptProcessor(CHUNK, 1, 1);
    proc.onaudioprocess = (e) => deliver(new Float32Array(e.inputBuffer.getChannelData(0)));
    source.connect(proc);
    proc.connect(sink);
    captureKind = 'ScriptProcessor';
    graph = {
      stop() {
        proc.onaudioprocess = null;
        source.disconnect();
        proc.disconnect();
        stopTracks();
      },
    };
  }

  /** The chosen mic if it opens, else the default one (unplugged, OverconstrainedError…). */
  async function openMic(): Promise<MediaStream> {
    const id = opts.micId?.();
    if (id) {
      try {
        return await navigator.mediaDevices.getUserMedia({ audio: { ...MIC_CONSTRAINTS, deviceId: { exact: id } } });
      } catch (e) {
        if (isDenied(e)) throw e;
        console.warn('[radio] chosen microphone unavailable, using the default', e);
      }
    }
    return navigator.mediaDevices.getUserMedia({ audio: { ...MIC_CONSTRAINTS } });
  }

  async function run() {
    mic = 'starting';
    notify();
    try {
      const c = ensureCtx();
      resume(c);
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('getUserMedia is not available');
      let stream: MediaStream;
      try {
        stream = await openMic();
      } catch (e) {
        mic = isDenied(e) ? 'denied' : 'error';
        return;
      }
      for (const t of stream.getAudioTracks()) {
        t.addEventListener('ended', () => {
          graph?.stop();
          graph = null;
          mic = 'off';
          notify();
        });
      }
      graph?.stop();
      track = stream.getAudioTracks()[0] ?? null;
      await capture(c, stream);
      mic = 'listening';
    } catch (e) {
      console.error('[radio] could not start', e);
      mic = 'error';
    }
  }

  return {
    get sampleRate() {
      return ensureCtx().sampleRate;
    },
    state: current,
    details() {
      if (!ctx) return null;
      return {
        label: track?.label ?? '',
        settings: track?.getSettings?.() ?? {},
        trackState: track?.readyState ?? 'none',
        muted: track?.muted ?? false,
        contextRate: ctx.sampleRate,
        contextState: ctx.state,
        capture: captureKind,
      };
    },
    start() {
      if (mic === 'listening') {
        if (ctx) resume(ctx);
        return Promise.resolve();
      }
      if (!starting) {
        const p: Promise<void> = run().finally(() => {
          if (starting === p) starting = null;
          notify();
        });
        starting = p;
      }
      return starting;
    },
    restart() {
      if (mic === 'off' && !starting) return Promise.resolve();
      // Queued after any start in flight; run() swaps the old capture graph for the new one.
      const p: Promise<void> = (starting ?? Promise.resolve()).then(run).finally(() => {
        if (starting === p) starting = null;
        notify();
      });
      starting = p;
      return p;
    },
    onState(fn) {
      stateFns.add(fn);
      return () => {
        stateFns.delete(fn);
      };
    },
    onSamples(fn) {
      sampleFns.add(fn);
      return () => {
        sampleFns.delete(fn);
      };
    },
    play(samples, onProgress) {
      let c: AudioContext;
      try {
        c = ensureCtx();
      } catch (e) {
        return { done: Promise.reject(e), stop() {} };
      }
      resume(c);
      const buffer = c.createBuffer(1, Math.max(1, samples.length), c.sampleRate);
      buffer.getChannelData(0).set(samples);
      const src = c.createBufferSource();
      src.buffer = buffer;
      src.connect(c.destination);
      const t0 = c.currentTime + START_LEAD_S;
      const dur = buffer.duration;

      let finished = false;
      let resolve!: () => void;
      const done = new Promise<void>((r) => {
        resolve = r;
      });
      const progress = () => {
        if (!finished) onProgress?.(Math.min(1, Math.max(0, (c.currentTime - t0) / dur)));
      };
      const ticker = setInterval(progress, PROGRESS_MS);
      // A context that never runs (no gesture, interrupted) would leave the queue stuck forever.
      const watchdog = setTimeout(() => finish(), (dur + START_LEAD_S) * 1000 + 3000);

      function finish() {
        if (finished) return;
        finished = true;
        clearInterval(ticker);
        clearTimeout(watchdog);
        src.onended = null;
        try {
          src.disconnect();
        } catch {
          /* already disconnected */
        }
        playing--;
        mutedUntil = performance.now() + TX_GUARD_MS;
        notify();
        resolve();
      }

      src.onended = () => {
        onProgress?.(1);
        finish();
      };
      playing++;
      notify();
      src.start(t0);
      return {
        done,
        stop() {
          if (finished) return;
          try {
            src.stop();
          } catch {
            /* not started */
          }
          finish();
        },
      };
    },
  };
}
