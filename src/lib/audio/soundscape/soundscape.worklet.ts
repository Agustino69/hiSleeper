/**
 * Procesador del AudioWorklet: corre en el hilo de audio (no en el de la
 * interfaz), así que sigue generando sonido con la pantalla apagada y sin cortes
 * aunque la app esté ocupada.
 */
import { Soundscape, type SceneId } from './dsp';

// Tipos mínimos del ámbito AudioWorkletGlobalScope (no vienen en lib.dom).
declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: new (options?: AudioWorkletNodeOptions) => object): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

export type SoundscapeMessage = { scene: SceneId };

class SoundscapeProcessor extends AudioWorkletProcessor {
  private scape = new Soundscape(sampleRate, (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0);

  constructor(options?: AudioWorkletNodeOptions) {
    super();
    // Escena inicial al crear el nodo: suena desde la primera muestra, sin esperar mensajes.
    const first = (options?.processorOptions as SoundscapeMessage | undefined)?.scene;
    if (first) this.scape.setScene(first);
    this.port.onmessage = (e: MessageEvent<SoundscapeMessage>) => this.scape.setScene(e.data.scene);
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    if (out?.[0]) this.scape.render(out[0], out[1] ?? out[0]);
    return true;
  }
}

registerProcessor('hisleeper-soundscape', SoundscapeProcessor);
