import { describe, expect, it } from 'vitest';
import { allowedMarkup, objectivePrompt, sanitizeScript, scriptPrompt, toTemplate } from '../src/lib/ai/scriptwriter';
import { extractText } from '../src/lib/tts/gemini';
import { splitScript } from '../src/lib/tts/render';

describe('instrucciones para Gemini', () => {
  it('cada motor recibe solo las etiquetas que entiende', () => {
    expect(allowedMarkup('supertonic')).toContain('<breath>');
    expect(allowedMarkup('supertonic')).not.toContain('<whispers>');
    expect(allowedMarkup('gemini')).toContain('<whispers>');
    expect(allowedMarkup('piper')).toContain('No uses ninguna etiqueta');
    expect(allowedMarkup('system')).toContain('No uses ninguna etiqueta');
  });

  it('el guion incluye tipo, duración, idioma, carácter de la voz e idea', () => {
    const p = scriptPrompt({ idea: 'soy pirata', kind: 'dream', length: 'short', engine: 'supertonic', styleHint: 'voz ronca' });
    expect(p).toContain('Sueño');
    expect(p).toContain('25 y 45 palabras');
    expect(p).toContain('español');
    expect(p).toContain('voz ronca');
    expect(p).toContain('«soy pirata»');
    expect(scriptPrompt({ idea: 'x', kind: 'review', length: 'long', engine: 'piper', lang: 'en' })).toContain('Idioma: en');
  });

  it('el repaso pide no inventar datos y usa los apuntes', () => {
    const p = objectivePrompt('review', 'Mitocondria: produce ATP');
    expect(p).toContain('SOLO información de los apuntes');
    expect(p).toContain('Apuntes de la persona');
    expect(objectivePrompt('dream', 'volar')).toContain('¿Estás soñando?');
  });
});

describe('limpieza del guion', () => {
  it('quita markdown, emojis, etiquetas no permitidas y comillas envolventes', () => {
    const raw = '“**Respira** 🌙 hondo... <breath>Suelta. <whispers> [Pausa 9] # fin”';
    expect(sanitizeScript(raw, 'supertonic')).toBe('Respira hondo... <breath>Suelta. [pausa 4] fin');
    expect(sanitizeScript(raw, 'gemini')).toContain('<whispers>');
    expect(sanitizeScript('<laugh> Hola', 'piper')).toBe('Hola');
    expect(sanitizeScript('Eres el capitán 🏴‍☠️ de un barco 🇲🇽 ⛵️.', 'gemini')).toBe('Eres el capitán de un barco.');
  });

  it('el resultado se puede dividir en frases para la voz', () => {
    const s = sanitizeScript('Eres el capitán... [pausa 2] El mar te mece. <sigh>', 'supertonic');
    expect(splitScript(s, 1).length).toBeGreaterThanOrEqual(2);
  });
});

describe('respuesta de Gemini', () => {
  it('toma el texto de model_output e ignora los pensamientos', () => {
    const data = { steps: [{ type: 'thought', content: [{ type: 'text', text: 'pienso…' }] }, { type: 'model_output', content: [{ type: 'text', text: '{"a":' }, { type: 'text', text: '1}' }] }] };
    expect(extractText(data)).toBe('{"a":1}');
  });

  it('convierte el objetivo en una plantilla válida aunque la IA se salga de la lista', () => {
    const t = toTemplate('dream', {
      name: 'Ciudad submarina',
      icon: '🐬🌊🫧',
      blurb: 'Bajo el mar.',
      notes: 'Exploro una ciudad bajo el mar.',
      styleId: 'inexistente',
      cue: 'trompeta',
      noise: 'none',
      tracks: [{ name: 'Al dormirme', text: '**Bajas** al fondo del mar... <whispers>' }, { name: '', text: '' }],
    });
    expect(t).toMatchObject({ goal: 'dream', styleId: 'cuento', cue: 'cuenco', noise: 'pink', name: 'Ciudad submarina' });
    expect(t.id.startsWith('ai-')).toBe(true);
    expect([...t.icon].length).toBeLessThanOrEqual(2);
    expect(t.tracks).toEqual([{ name: 'Al dormirme', text: 'Bajas al fondo del mar...' }]);
    expect(toTemplate('mantra', { tracks: [{ name: 'a', text: 'Estoy en calma.' }] }).cue).toBeNull();
    expect(() => toTemplate('dream', { tracks: [] })).toThrow();
  });
});
