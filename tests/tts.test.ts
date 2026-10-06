import { describe, expect, it } from 'vitest';
import { CUE_SOUNDS } from '../src/lib/audio/synth';
import { buildInstructions, OPENAI_VOICES } from '../src/lib/tts/openai';
import { PIPER_VOICES } from '../src/lib/tts/piper';
import { specFromStyle, styleById, TEMPLATES, VOICE_STYLES } from '../src/lib/tts/presets';
import { piperParams, pitchRate, splitScript } from '../src/lib/tts/render';

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
  const piperIds = new Set(PIPER_VOICES.map((v) => v.id));
  const openaiIds = new Set(OPENAI_VOICES.map((v) => v.id));

  it('cada estilo apunta a voces existentes y parámetros válidos', () => {
    for (const s of VOICE_STYLES) {
      expect(piperIds.has(s.piperVoice), s.id).toBe(true);
      expect(openaiIds.has(s.openaiVoice), s.id).toBe(true);
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
      if (t.piperVoice) expect(piperIds.has(t.piperVoice)).toBe(true);
      expect(t.tracks.length).toBeGreaterThan(0);
      for (const tr of t.tracks) expect(splitScript(tr.text, 1).length).toBeGreaterThan(0);
    }
  });

  it('existe la plantilla pirata con estilo pirata y oleaje', () => {
    const p = TEMPLATES.find((t) => t.id === 'pirata')!;
    expect(p).toMatchObject({ goal: 'dream', styleId: 'pirata', noise: 'ocean', cue: 'campana' });
  });

  it('las indicaciones para la nube reflejan ritmo y expresividad', () => {
    const s = specFromStyle(styleById('pirata')!, 'openai');
    const text = buildInstructions({ ...s, speed: 0.7, expressiveness: 90 });
    expect(text).toContain('capitán pirata');
    expect(text).toContain('muy despacio');
    expect(text).toContain('expresividad');
  });
});
