/**
 * Normalización de texto de Supertonic (del ejemplo web oficial, MIT,
 * github.com/supertone-inc/supertonic). La comparten el worker web y el motor nativo.
 */

export const LANGS = ['en', 'ko', 'ja', 'ar', 'bg', 'cs', 'da', 'de', 'el', 'es', 'et', 'fi', 'fr', 'hi', 'hr', 'hu', 'id', 'it', 'lt', 'lv', 'nl', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sv', 'tr', 'uk', 'vi'];

/** Normalización de texto del ejemplo oficial. */
export function preprocessText(input: string, lang: string): string {
  let text = input.normalize('NFKD');
  text = text.replace(
    /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}]+/gu,
    '',
  );
  const replacements: Record<string, string> = {
    '–': '-',
    '‑': '-',
    '—': '-',
    _: ' ',
    '“': '"',
    '”': '"',
    '‘': "'",
    '’': "'",
    '´': "'",
    '`': "'",
    '[': ' ',
    ']': ' ',
    '|': ' ',
    '/': ' ',
    '#': ' ',
    '→': ' ',
    '←': ' ',
  };
  for (const [k, v] of Object.entries(replacements)) text = text.replaceAll(k, v);
  text = text.replace(/[♥☆♡©\\]/g, '');
  text = text.replace(/ ([,.!?;:'])/g, '$1');
  text = text.replace(/""+/g, '"').replace(/''+/g, "'");
  text = text.replace(/\s+/g, ' ').trim();
  if (!/[.!?;:,'")\]}…。」』】〉》›»>]$/.test(text)) text += '.';
  if (!LANGS.includes(lang)) throw new Error(`Idioma no disponible: ${lang}`);
  return `<${lang}>${text}</${lang}>`;
}

/** Índices de entrada del modelo (como en el ejemplo oficial: por unidad UTF-16). */
export function textToIds(text: string, lang: string, indexer: number[]): number[] {
  const t = preprocessText(text, lang);
  const ids: number[] = [];
  for (let j = 0; j < t.length; j++) {
    const cp = t.codePointAt(j)!;
    ids.push(cp < indexer.length ? indexer[cp] : -1);
  }
  return ids;
}
