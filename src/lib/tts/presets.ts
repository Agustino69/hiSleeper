import type { CueSoundId, Goal, NoiseType, SynthSpec } from '../types';

/** Estilos de voz: cada uno ajusta todos los controles de una vez. */
export interface VoiceStyle {
  id: string;
  icon: string;
  label: string;
  blurb: string;
  /** Voz Piper sugerida. */
  piperVoice: string;
  openaiVoice: string;
  params: Pick<SynthSpec, 'speed' | 'expressiveness' | 'rhythm' | 'pitch' | 'pause' | 'reverb' | 'warmth'>;
  instructions: string;
}

export const VOICE_STYLES: VoiceStyle[] = [
  {
    id: 'susurro',
    icon: '🌙',
    label: 'Susurro para dormir',
    blurb: 'Lento, suave y cálido',
    piperVoice: 'es_MX-claude-high#0',
    openaiVoice: 'shimmer',
    params: { speed: 0.78, expressiveness: 30, rhythm: 30, pitch: -1, pause: 1.6, reverb: 15, warmth: 75 },
    instructions: 'Susurra con voz muy suave, lenta y cálida, como quien acompaña a alguien a dormirse.',
  },
  {
    id: 'meditacion',
    icon: '🧘',
    label: 'Meditación guiada',
    blurb: 'Serena, con respiraciones',
    piperVoice: 'es_ES-sharvard-medium#1',
    openaiVoice: 'sage',
    params: { speed: 0.82, expressiveness: 40, rhythm: 35, pitch: -1, pause: 2, reverb: 30, warmth: 60 },
    instructions: 'Guía una meditación: voz serena, profunda y acogedora, dejando respirar cada frase.',
  },
  {
    id: 'cuento',
    icon: '📖',
    label: 'Cuentacuentos',
    blurb: 'Cálido, con asombro',
    piperVoice: 'es_MX-claude-high#0',
    openaiVoice: 'fable',
    params: { speed: 0.92, expressiveness: 80, rhythm: 75, pitch: 0, pause: 1, reverb: 20, warmth: 50 },
    instructions: 'Narra como un cuentacuentos nocturno: cálido, con asombro y un misterio suave, dando vida a la historia.',
  },
  {
    id: 'pirata',
    icon: '🏴‍☠️',
    label: 'Capitán pirata',
    blurb: 'Grave, teatral y aventurero',
    piperVoice: 'es_ES-davefx-medium#0',
    openaiVoice: 'verse',
    params: { speed: 0.9, expressiveness: 90, rhythm: 80, pitch: -3, pause: 1.1, reverb: 25, warmth: 55 },
    instructions:
      'Eres un viejo capitán pirata contando su aventura junto al fuego del camarote: voz grave y algo ronca, teatral, con picardía y misterio, pero en tono bajo y cercano.',
  },
  {
    id: 'cosmos',
    icon: '🌌',
    label: 'Voz del cosmos',
    blurb: 'Profunda y envolvente',
    piperVoice: 'es_MX-ald-medium#0',
    openaiVoice: 'onyx',
    params: { speed: 0.8, expressiveness: 55, rhythm: 50, pitch: -2, pause: 1.8, reverb: 75, warmth: 60 },
    instructions: 'Voz profunda y etérea, como un narrador del universo: lenta, envolvente y llena de calma.',
  },
  {
    id: 'hada',
    icon: '🧚',
    label: 'Bosque encantado',
    blurb: 'Mágica y luminosa',
    piperVoice: 'es_ES-sharvard-medium#1',
    openaiVoice: 'nova',
    params: { speed: 0.9, expressiveness: 75, rhythm: 70, pitch: 2, pause: 1.2, reverb: 45, warmth: 45 },
    instructions: 'Voz mágica y luminosa, como un hada que guía por un bosque encantado, con dulzura y asombro.',
  },
  {
    id: 'coach',
    icon: '💪',
    label: 'Coach de confianza',
    blurb: 'Firme y serena',
    piperVoice: 'es_MX-ald-medium#0',
    openaiVoice: 'ash',
    params: { speed: 0.97, expressiveness: 60, rhythm: 45, pitch: 0, pause: 1.2, reverb: 5, warmth: 35 },
    instructions: 'Habla con seguridad y calidez, como un coach que cree en ti: firme pero sereno.',
  },
  {
    id: 'profesor',
    icon: '🎓',
    label: 'Profesor claro',
    blurb: 'Articulado, para repasar',
    piperVoice: 'es_ES-sharvard-medium#0',
    openaiVoice: 'cedar',
    params: { speed: 0.9, expressiveness: 45, rhythm: 40, pitch: 0, pause: 1.4, reverb: 0, warmth: 30 },
    instructions: 'Explica con claridad, articulando bien cada palabra clave, con el tono tranquilo de un profesor paciente.',
  },
];

export const styleById = (id?: string) => VOICE_STYLES.find((s) => s.id === id);

export function specFromStyle(style: VoiceStyle, engine: SynthSpec['engine'], voice?: string): SynthSpec {
  return {
    engine,
    voice: voice ?? (engine === 'openai' ? style.openaiVoice : style.piperVoice),
    styleId: style.id,
    ...style.params,
    instructions: style.instructions,
  };
}

/** Plantillas: un objetivo completo listo para usar (guion, voz, señal y fondo). */
export interface Template {
  id: string;
  icon: string;
  name: string;
  goal: Goal;
  blurb: string;
  cue: CueSoundId | null;
  styleId: string;
  /** Voz Piper concreta si la plantilla la necesita (p. ej. inglés). */
  piperVoice?: string;
  noise?: NoiseType;
  notes: string;
  tracks: Array<{ name: string; text: string }>;
}

export const TEMPLATES: Template[] = [
  {
    id: 'pirata',
    icon: '🏴‍☠️',
    name: 'Soñar que soy pirata',
    goal: 'dream',
    blurb: 'Capitán de tu propio barco, rumbo a una isla con un tesoro. Campana de barco y oleaje.',
    cue: 'campana',
    styleId: 'pirata',
    noise: 'ocean',
    notes:
      'Soy el capitán de un barco pirata. Siento el timón de madera en mis manos, el viento salado, las velas hinchadas. Navego hacia una isla con palmeras donde me espera un tesoro.',
    tracks: [
      {
        name: 'Pirata · zarpar',
        text: `Esta noche eres el capitán de un barco pirata...
Sientes la madera tibia del timón bajo tus manos. [pausa]
El viento salado te despeina, y las velas se hinchan sobre tu cabeza...
Oyes crujir el casco, las gaviotas, las olas que golpean la proa.

A lo lejos aparece una isla con palmeras. Tu tripulación grita: ¡tierra a la vista!
En tu bolsillo llevas un mapa antiguo. Una equis marca el tesoro...

Cuando te duermas, volverás a este barco. Esta noche, en tus sueños, navegas como pirata.`,
      },
      {
        name: 'Pirata · ¿estás soñando?',
        text: 'El mar te mece... Eres un pirata en tu barco... [pausa 2] ¿Estás soñando?',
      },
    ],
  },
  {
    id: 'volar',
    icon: '🕊️',
    name: 'Soñar que vuelo',
    goal: 'dream',
    blurb: 'Despegar suavemente y flotar sobre el mar al atardecer.',
    cue: 'flauta',
    styleId: 'cuento',
    noise: 'pink',
    notes: 'Vuelo sobre el mar al atardecer. Mi cuerpo es ligero, el aire tibio me sostiene, veo el horizonte naranja.',
    tracks: [
      {
        name: 'Volar · despegar',
        text: `Imagina que tu cuerpo se vuelve ligero... muy ligero.
Tus pies se separan del suelo, y empiezas a flotar. [pausa]
Subes despacio sobre los tejados, sobre los árboles...
Abajo, el mar brilla con el último sol de la tarde.

El aire tibio te sostiene como una mano gigante. No hay miedo, solo libertad.
Esta noche, cuando sueñes, vas a volar.`,
      },
      { name: 'Volar · ¿estás soñando?', text: 'Estás flotando... ligero como el aire... [pausa 2] ¿Estás soñando?' },
    ],
  },
  {
    id: 'astronauta',
    icon: '🚀',
    name: 'Viajar por el espacio',
    goal: 'dream',
    blurb: 'Flotar en una nave, ver la Tierra azul y caminar entre estrellas.',
    cue: 'cristal',
    styleId: 'cosmos',
    noise: 'brown',
    notes: 'Floto dentro de mi nave espacial. Por la ventana veo la Tierra azul. Salgo a caminar entre estrellas, en silencio absoluto.',
    tracks: [
      {
        name: 'Espacio · despegue',
        text: `Estás dentro de una nave, flotando en silencio...
Por la ventana redonda, la Tierra gira, azul y enorme. [pausa]
Las estrellas no parpadean aquí: brillan quietas, infinitas.

Abres la compuerta y sales a caminar en el vacío, ligero, tranquilo...
Esta noche, en tus sueños, viajas por el espacio.`,
      },
      { name: 'Espacio · ¿estás soñando?', text: 'Flotas entre estrellas... [pausa 2] ¿Estás soñando?' },
    ],
  },
  {
    id: 'calma',
    icon: '🌊',
    name: 'Calma profunda',
    goal: 'mantra',
    blurb: 'Soltar el cuerpo y la mente para dormir mejor.',
    cue: null,
    styleId: 'susurro',
    notes: 'Mi cuerpo se suelta. Estoy a salvo. Respiro lento y profundo. Todo está en calma.',
    tracks: [
      {
        name: 'Calma · soltar',
        text: `Mi cuerpo se suelta... [pausa]
Estoy a salvo. [pausa]
Respiro lento... y profundo...
Todo está en calma.`,
      },
    ],
  },
  {
    id: 'confianza',
    icon: '💪',
    name: 'Confianza en mí',
    goal: 'mantra',
    blurb: 'Afirmaciones de seguridad para empezar el día con fuerza.',
    cue: null,
    styleId: 'coach',
    notes: 'Confío en mí. Soy capaz. Cada día me siento más seguro y tranquilo.',
    tracks: [
      {
        name: 'Confianza · afirmaciones',
        text: `Confío en mí. [pausa]
Soy capaz de lograr lo que me propongo. [pausa]
Cada día me siento más seguro... y más tranquilo.`,
      },
    ],
  },
  {
    id: 'ingles',
    icon: '🇬🇧',
    name: 'Vocabulario de inglés',
    goal: 'review',
    blurb: 'Ejemplo de repaso: estudia las tarjetas con la señal y de noche se reactivan. Edítalas con tus palabras.',
    cue: 'kalimba',
    styleId: 'profesor',
    piperVoice: 'en_US-amy-medium#0',
    notes: 'whisper — susurrar\n\nlighthouse — faro\n\nharbor — puerto\n\nstarry — estrellado\n\nto drift off — quedarse dormido',
    tracks: [{ name: 'Inglés · palabras', text: 'Whisper. [pausa] Lighthouse. [pausa] Harbor. [pausa] Starry. [pausa] To drift off.' }],
  },
];
