import { describe, expect, it } from 'vitest';
import { CUE_SOUNDS } from '../src/lib/audio/synth';
import { buildStyle, extractAudio, GEMINI_VOICES, toGeminiText } from '../src/lib/tts/gemini';
import { mixStyles, SUPERTONIC_VOICES } from '../src/lib/tts/supertonic';
import { preprocessText, textToIds } from '../src/lib/tts/supertonicText';
import { specFromStyle, styleById, TEMPLATES, VOICE_STYLES } from '../src/lib/tts/presets';
import { cleanTags, piperParams, pitchRate, splitScript, supertonicParams } from '../src/lib/tts/render';

describe('splitScript', () => {
  it('separa frases y aplica pausas de puntos suspensivos, párrafos y [pausa]', () => {
    const parts = splitScript('Hola marinero... [pausa 2] El mar te mece.\n\n¿Estás soñando?', 1);
    expect(parts.map((p) => p.text)).toEqual(['Hola marinero.', 'El mar te mece.', '¿Estás soñando?']);
    expect(parts[0].pauseAfter).toBeCloseTo(2.2 + 2);
    expect(parts[1].pauseAfter).toBeCloseTo(1 + 1.9);
    expect(parts[2].pauseAfter).toBe(0);
  });

  it('acepta [pausa] sin número, coma decimal e ignora fragmentos sin letras', () => {
    const parts = splitScript('Uno. [pausa] Dos [pausa 1,5s] ... Tres', 0.5);
    expect(parts.map((p) => p.text)).toEqual(['Uno.', 'Dos', 'Tres']);
    expect(parts[0].pauseAfter).toBeCloseTo(0.5 + 1.5);
    expect(parts[1].pauseAfter).toBeCloseTo(0.5 + 1.5);
  });

  it('texto vacío no produce frases', () => {
    expect(splitScript('  ...  \n\n', 1)).toEqual([]);
  });
});

describe('parámetros Piper', () => {
  const base = specFromStyle(VOICE_STYLES[0], 'piper');
  it('la velocidad se traduce en length_scale y el tono se compensa', () => {
    expect(piperParams({ ...base, speed: 0.5, pitch: 0 }).lengthScale).toBeCloseTo(2);
    expect(piperParams({ ...base, speed: 1, pitch: 12 }).lengthScale).toBeCloseTo(2);
    expect(pitchRate(-12)).toBeCloseTo(0.5);
  });
  it('expresividad y ritmo dentro de rangos estables del modelo', () => {
    for (const v of [0, 50, 100]) {
      const p = piperParams({ ...base, expressiveness: v, rhythm: v });
      expect(p.noiseScale).toBeGreaterThanOrEqual(0.3);
      expect(p.noiseScale).toBeLessThanOrEqual(1);
      expect(p.noiseW).toBeGreaterThanOrEqual(0.2);
      expect(p.noiseW).toBeLessThanOrEqual(1.2);
    }
    expect(piperParams({ ...base, expressiveness: 50 }).noiseScale).toBeCloseTo(0.65);
  });
});

describe('presets y plantillas', () => {
  const deviceIds = new Set(SUPERTONIC_VOICES.map((v) => v.id));
  const cloudIds = new Set(GEMINI_VOICES.map((v) => v.id));

  it('cada estilo apunta a voces existentes y parámetros válidos', () => {
    for (const s of VOICE_STYLES) {
      expect(deviceIds.has(s.deviceVoice), s.id).toBe(true);
      expect(cloudIds.has(s.cloudVoice), s.id).toBe(true);
      if (s.mixWith) expect(deviceIds.has(s.mixWith), s.id).toBe(true);
      expect(s.params.speed).toBeGreaterThanOrEqual(0.6);
      expect(s.params.speed).toBeLessThanOrEqual(1.4);
      expect(Math.abs(s.params.pitch)).toBeLessThanOrEqual(6);
    }
  });

  it('cada plantilla usa estilo, señal y voz válidos y tiene guiones', () => {
    const cues = new Set(CUE_SOUNDS.map((c) => c.id));
    for (const t of TEMPLATES) {
      expect(styleById(t.styleId), t.id).toBeDefined();
      if (t.cue) expect(cues.has(t.cue)).toBe(true);
      if (t.lang) expect(['en', 'es', 'fr', 'pt', 'it', 'de']).toContain(t.lang);
      expect(t.tracks.length).toBeGreaterThan(0);
      for (const tr of t.tracks) expect(splitScript(tr.text, 1).length).toBeGreaterThan(0);
    }
  });

  it('existe la plantilla pirata con estilo pirata y oleaje', () => {
    const p = TEMPLATES.find((t) => t.id === 'pirata')!;
    expect(p).toMatchObject({ goal: 'dream', styleId: 'pirata', noise: 'ocean', cue: 'campana' });
  });

  it('las indicaciones para la nube reflejan ritmo y expresividad', () => {
    const sp = specFromStyle(styleById('pirata')!, 'gemini');
    expect(sp.voice).toBe('Algenib');
    const text = buildStyle({ ...sp, speed: 0.7, expressiveness: 90 });
    expect(text).toContain('capitán pirata');
    expect(text).toContain('muy despacio');
    expect(text).toContain('en español');
    expect(buildStyle({ ...sp, lang: 'en' })).not.toContain('en español');
  });
});

describe('etiquetas expresivas', () => {
  const text = '<breath> Hola <whispers> marinero <laugh> ¿listo? <yawn>';
  it('Supertonic conserva respiración, suspiro y risa; quita el resto', () => {
    expect(cleanTags(text, 'supertonic')).toBe('<breath> Hola marinero <laugh> ¿listo?');
  });
  it('Piper no lee ninguna etiqueta', () => {
    expect(cleanTags(text, 'piper')).toBe('Hola marinero ¿listo?');
  });
  it('Gemini recibe todas y traduce las pausas', () => {
    expect(cleanTags(text, 'gemini')).toBe(text);
    expect(toGeminiText('Hola [pausa 1] mar [pausa 3] fin...')).toBe('Hola <short pause> mar <long pause> fin... <short pause>');
  });
});

describe('Gemini', () => {
  it('extrae el último audio de la respuesta', () => {
    const r = {
      steps: [
        { type: 'thought', content: [{ type: 'text' }] },
        { type: 'model_output', content: [{ type: 'audio', data: 'AAA', mime_type: 'audio/wav' }] },
        { type: 'model_output', content: [{ type: 'audio', data: 'BBB' }] },
      ],
    };
    expect(extractAudio(r)).toEqual({ data: 'BBB', mimeType: undefined });
    expect(extractAudio({})).toBeNull();
  });
});

describe('Supertonic', () => {
  it('normaliza el texto como el ejemplo oficial', () => {
    expect(preprocessText('Hola — “mundo”  ', 'es')).toBe('<es>Hola - "mundo"</es>');
    expect(preprocessText('Buenas noches', 'es')).toBe('<es>Buenas noches.</es>');
    expect(preprocessText('¿Listo? <laugh>', 'es')).toBe('<es>¿Listo? <laugh></es>');
    expect(() => preprocessText('hola', 'xx')).toThrow();
  });

  it('convierte a índices con el indexador (desconocidos = -1)', () => {
    const indexer = Array.from({ length: 200 }, (_, i) => i + 1000);
    const ids = textToIds('a', 'es', indexer);
    expect(ids).toHaveLength('<es>a.</es>'.length);
    expect(ids[4]).toBe(1000 + 'a'.charCodeAt(0));
    expect(textToIds('ā', 'es', indexer)).toContain(-1);
  });

  it('mezcla dos voces de forma lineal', () => {
    const a = { ttl: Float32Array.from([0, 10]), ttlDims: [1, 1, 2], dp: Float32Array.from([2]), dpDims: [1, 1, 1] };
    const b = { ttl: Float32Array.from([10, 20]), ttlDims: [1, 1, 2], dp: Float32Array.from([4]), dpDims: [1, 1, 1] };
    const m = mixStyles(a, b, 0.25);
    expect([...m.ttl]).toEqual([2.5, 12.5]);
    expect([...m.dp]).toEqual([2.5]);
  });

  it('el tono se compensa con la velocidad y la expresividad sube el ruido inicial', () => {
    const sp = specFromStyle(styleById('pirata')!, 'supertonic');
    expect(sp).toMatchObject({ engine: 'supertonic', voice: 'st:M2', mixWith: 'st:M5', mix: 30, quality: 8 });
    const p = supertonicParams({ ...sp, speed: 1, pitch: 12, expressiveness: 100 });
    expect(p.speed).toBeCloseTo(0.5);
    expect(p.temperature).toBeCloseTo(1.15);
    expect(p.mix).toBeCloseTo(0.3);
  });
});
