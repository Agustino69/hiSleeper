import { Capacitor, registerPlugin } from '@capacitor/core';
import { TextToSpeech } from '@capacitor-community/text-to-speech';

/** Puente con la app nativa de Android (Capacitor). En el navegador no hace nada. */

export const isNative = Capacitor.isNativePlatform();

interface SleepSessionPlugin {
  start(options: { title: string; text: string; keepScreenOn: boolean }): Promise<void>;
  stop(): Promise<void>;
}

const SleepSession = registerPlugin<SleepSessionPlugin>('SleepSession');

/**
 * Inicia el servicio en primer plano que mantiene vivo el audio con la pantalla
 * apagada. La pantalla solo se mantiene encendida si se pide (el detector de
 * movimiento necesita la pantalla encendida para recibir el acelerómetro).
 */
export async function startNativeSession(text: string, keepScreenOn: boolean): Promise<boolean> {
  if (!isNative) return false;
  try {
    await SleepSession.start({ title: 'hiSleeper · sesión nocturna', text, keepScreenOn });
    return true;
  } catch {
    return false;
  }
}

export async function stopNativeSession(): Promise<void> {
  if (isNative) await SleepSession.stop().catch(() => undefined);
}

export interface VoiceInfo {
  voiceURI: string;
  name: string;
  lang: string;
  localService: boolean;
}

let nativeVoices: VoiceInfo[] | null = null;

export async function nativeVoiceList(): Promise<VoiceInfo[]> {
  if (!nativeVoices) {
    try {
      nativeVoices = (await TextToSpeech.getSupportedVoices()).voices;
    } catch {
      nativeVoices = [];
    }
  }
  return nativeVoices;
}

export async function speakNative(text: string, opts: { voiceURI?: string; rate: number; volume: number }): Promise<void> {
  const voices = await nativeVoiceList();
  const lang = navigator.language;
  let index = voices.findIndex((v) => v.voiceURI === opts.voiceURI);
  if (index < 0) index = voices.findIndex((v) => v.lang.startsWith(lang.slice(0, 2)) && v.localService);
  await TextToSpeech.speak({
    text,
    lang: index >= 0 ? voices[index].lang : lang,
    voice: index >= 0 ? index : undefined,
    rate: opts.rate,
    pitch: 0.95,
    volume: opts.volume,
  });
}

export function stopNativeSpeech() {
  if (isNative) void TextToSpeech.stop().catch(() => undefined);
}
