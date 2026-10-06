/** Utilidades del dispositivo: micrófono, pantalla encendida y acelerómetro. */

export class VoiceRecorder {
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private stream: MediaStream | null = null;
  startedAt = 0;

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg'].find(
      (m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m),
    );
    this.rec = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
    this.chunks = [];
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.rec.start();
    this.startedAt = Date.now();
  }

  stop(): Promise<{ blob: Blob; durationSec: number }> {
    return new Promise((resolve, reject) => {
      const rec = this.rec;
      if (!rec) return reject(new Error('No se está grabando'));
      rec.onstop = () => {
        const blob = new Blob(this.chunks, { type: rec.mimeType || 'audio/webm' });
        this.release();
        resolve({ blob, durationSec: (Date.now() - this.startedAt) / 1000 });
      };
      rec.stop();
    });
  }

  cancel() {
    if (this.rec && this.rec.state !== 'inactive') this.rec.stop();
    this.release();
  }

  private release() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.rec = null;
  }
}

/** Mantiene la pantalla encendida (y la página activa) durante la noche. */
export class ScreenLock {
  private sentinel: WakeLockSentinel | null = null;
  private wanted = false;
  private onVis = () => {
    if (this.wanted && document.visibilityState === 'visible') void this.acquire();
  };

  get supported() {
    return 'wakeLock' in navigator;
  }

  async enable() {
    this.wanted = true;
    document.addEventListener('visibilitychange', this.onVis);
    await this.acquire();
  }

  private async acquire() {
    if (!this.supported || this.sentinel) return;
    try {
      this.sentinel = await navigator.wakeLock.request('screen');
      this.sentinel.addEventListener('release', () => (this.sentinel = null));
    } catch {
      this.sentinel = null;
    }
  }

  async disable() {
    this.wanted = false;
    document.removeEventListener('visibilitychange', this.onVis);
    await this.sentinel?.release().catch(() => undefined);
    this.sentinel = null;
  }
}

type MotionPermissionApi = { requestPermission?: () => Promise<'granted' | 'denied'> };

/**
 * Detector de movimiento (actigrafía simple): con el móvil sobre el colchón,
 * un cambio brusco de aceleración indica que te giraste o te despertaste.
 * En ese momento se pausan las pistas para no fragmentar el sueño.
 */
export class MotionMonitor {
  private gravity: [number, number, number] | null = null;
  private lastFire = 0;
  private handler = (e: DeviceMotionEvent) => this.onMotion(e);
  private threshold = 0.4;
  private cb: (intensity: number) => void = () => undefined;

  static async requestPermission(): Promise<boolean> {
    const api = (globalThis as unknown as { DeviceMotionEvent?: MotionPermissionApi }).DeviceMotionEvent;
    if (!api) return false;
    if (typeof api.requestPermission === 'function') {
      try {
        return (await api.requestPermission()) === 'granted';
      } catch {
        return false;
      }
    }
    return true;
  }

  /** sensitivity 1 (poca) - 5 (mucha). */
  start(sensitivity: number, cb: (intensity: number) => void) {
    this.threshold = [0, 0.9, 0.6, 0.4, 0.25, 0.15][Math.max(1, Math.min(5, sensitivity))];
    this.cb = cb;
    this.gravity = null;
    window.addEventListener('devicemotion', this.handler);
  }

  stop() {
    window.removeEventListener('devicemotion', this.handler);
  }

  private onMotion(e: DeviceMotionEvent) {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x == null || a.y == null || a.z == null) return;
    const cur: [number, number, number] = [a.x, a.y, a.z];
    if (!this.gravity) {
      this.gravity = cur;
      return;
    }
    // Filtro paso bajo para estimar la gravedad; lo que queda es movimiento.
    const k = 0.9;
    let mag = 0;
    for (let i = 0; i < 3; i++) {
      this.gravity[i] = k * this.gravity[i] + (1 - k) * cur[i];
      const d = cur[i] - this.gravity[i];
      mag += d * d;
    }
    mag = Math.sqrt(mag);
    const now = Date.now();
    if (mag > this.threshold && now - this.lastFire > 15000) {
      this.lastFire = now;
      this.cb(mag);
    }
  }
}
