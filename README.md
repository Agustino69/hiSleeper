# hiSleeper 🌙

App web instalable (PWA) que reproduce pistas y audios de voz **durante el sueño, en el momento adecuado del ciclo**, para:

- **📚 Repasar un tema**: reactivación dirigida de la memoria (*targeted memory reactivation*, TMR). Estudias con un sonido firma y ese sonido se repite, muy bajo, en tu sueño profundo.
- **🕯️ Mantras / afirmaciones**: tu voz al dormirte (con volumen descendente) y en los 20 min previos a despertar.
- **🌙 Soñar con algo**: incubación de sueños en la hipnagogia y en los REM largos de la madrugada.

Todo se guarda en el dispositivo (IndexedDB): grabaciones, objetivos, diario y ajustes.

## Cómo funciona

1. **Pistas**: graba tu voz, importa audios o usa texto a voz.
2. **Objetivos**: cada uno tiene un tipo, una señal sonora (generada en el dispositivo), pistas y apuntes/intención.
3. **Preparación**: antes de dormir, «Estudiar con la señal» (tarjetas) o «Visualizar» (3 min). De noche solo se reactiva lo que asociaste despierto.
4. **Noche**: la app estima tu hipnograma (latencia + ciclos de ~90 min; N3 al principio, REM al final) y reproduce cada objetivo solo en sus ventanas:

   | Ventana | Cuándo | Objetivos |
   |---|---|---|
   | Hipnagogia | desde que te acuestas hasta ~10 min después de dormirte, volumen descendente | mantra, sueño |
   | Sueño profundo (N3) | primeros 1–4 ciclos, con márgenes | repaso |
   | REM | REM a partir del 3.er ciclo | sueño |
   | Amanecer | 20 min antes de la alarma | mantra |

5. **Diario**: al despertar anotas o grabas el sueño y si apareció lo incubado; la app muestra tu tasa de recuerdo e incubación.

### Para no romper el sueño
- Volumen logarítmico con rampas de entrada y salida, compresor y paso bajo en el bus de voz, normalización de sonoridad de cada pista.
- **Fondos sonoros generativos**, que enmascaran la casa y las pistas: lluvia, oleaje, viento, fogata, noche de grillos, música ambiental y ruido rosa, marrón o blanco. Ninguno es una grabación en bucle: se sintetizan muestra a muestra en tiempo real, así que nunca se repiten (ver abajo).
- Intervalos con variación aleatoria (evita la habituación).
- **Detector de movimiento** (acelerómetro, móvil sobre el colchón): pausa las pistas y baja el volumen el resto de la noche.
- Pantalla negra con *Wake Lock* para que el navegador no detenga el audio; despertador suave opcional.

### Fondos generativos
Cada fondo es un pequeño modelo físico que corre en un **AudioWorklet** (el hilo de audio del navegador o del WebView de Android), así que sigue sonando con la pantalla apagada y no se corta aunque la app esté ocupada. Usa unos 1–2 % de una CPU. Las técnicas son las de la síntesis procedural de sonido (A. Farnell, *Designing Sound*, MIT Press), sin muestras grabadas:

| Fondo | Cómo se genera |
|---|---|
| Lluvia | lecho de ruido rosa en banda con centro que deriva + gotas (proceso de Poisson: chirrido senoidal o ráfaga de ruido, paneo aleatorio); la intensidad pasa de llovizna a moderada en minutos |
| Oleaje | dos trenes de olas independientes (6–12 s, altura y pausa aleatorias); el filtro se abre con cada ola y la cresta añade espuma |
| Viento | ruido rosa por dos filtros de banda cuyo centro, resonancia y ráfaga derivan con transiciones suaves |
| Fogata | rugido grave + chasquidos en ráfagas (la madera estalla en series cortas) |
| Noche de grillos | cinco grillos con su propio tono (3,9–5,2 kHz), ritmo y silencios, y brisa suave |
| Música ambiental | cinco voces en pentatónica de re (nada disuena) con ataques y finales lentos, coro y eco estéreo; nunca repite la misma secuencia |
| Rosa, marrón, blanco | ruido de color con tono y nivel que «respiran» muy despacio |

Las variaciones lentas usan **derivas aleatorias** (van a un objetivo al azar con una curva suave), no osciladores periódicos: no hay patrón que el oído pueda aprender. El cambio de fondo es un fundido de potencia constante y la salida pasa por un limitador suave. El volumen de cada fondo está calibrado (RMS) en `tests/soundscape.test.ts`.

## Voces IA

En **Pistas → ✨ Voz IA** se escribe un guion y se genera una pista de audio (se guarda como WAV: suena de noche con fundidos y sin conexión). Todo es gratis:

| Motor | Calidad | Requisitos |
|---|---|---|
| **Natural** — [Supertonic 3](https://huggingface.co/Supertone/supertonic-3) (Supertone, 31 idiomas, 10 voces) | natural, con `<breath>`, `<sigh>`, `<laugh>` | descarga única. **Android:** ONNX Runtime nativo con la versión [int8](https://huggingface.co/soniqo/Supertonic-3-ONNX-INT8) (~105 MB, ~2× más rápido que tiempo real en CPU de 4 hilos). **Navegador:** onnxruntime-web con la versión fp32 (~400 MB; el int8 es muy lento en WebAssembly) |
| Natural clásica — [Piper](https://github.com/rhasspy/piper) | acentos de México/España | ~19 MB de fonemizador + 63–77 MB por voz |
| **Actuada** — Google Gemini 3.8 Flash TTS | la más expresiva: indicaciones de actuación y etiquetas (`<whispers>`, `<sigh>`, `<yawn>`, `<laugh>`…) | clave gratuita de [Google AI Studio](https://aistudio.google.com/apikey) (nivel gratuito, con límites de uso) |
| Básica del sistema | robótica | nada |

Controles: **ritmo**, **expresividad** (Supertonic: ruido inicial del modelo de flujo; Piper: `noise_scale`), **naturalidad del ritmo** (Piper: `noise_w`), **mezcla de timbre** entre dos voces y **calidad** (pasos de refinado) en Supertonic, **tono** (remuestreo con la duración compensada), **pausas** entre frases, **espacio/eco** (convolución) y **calidez** (ecualización). En la nube, los controles se traducen a indicaciones de actuación.

El guion admite `...` (pausa larga), línea en blanco (pausa de párrafo), `[pausa 3]` (3 s de silencio) y etiquetas expresivas (cada motor ignora las que no entiende).

**✨ Escribir con IA** (Gemini 3.8 Flash, nivel gratuito, misma clave que la voz actuada):
- En el Estudio de voz: describes la idea, eliges tipo (sueño, mantra, repaso o libre) y duración, y Gemini escribe el guion en presente y con detalles sensoriales, usando solo las marcas que entiende el motor de voz elegido. El texto se limpia (markdown, emojis, etiquetas no válidas) y se puede editar o deshacer.
- En Objetivos → Nuevo → **Crear con IA**: a partir de una idea (o de tus apuntes, para repasar, sin inventar datos) crea el objetivo completo —guiones, intención o tarjetas, estilo de voz, señal y fondo— y lo abre en la hoja de plantillas para revisarlo antes de generar las voces.
- Las peticiones usan `store: false` (Google no guarda la conversación). En el nivel gratuito, Google puede usar el contenido para mejorar sus productos.

**Estilos:** 🌙 Susurro para dormir · 🧘 Meditación guiada · 📖 Cuentacuentos · 🏴‍☠️ Capitán pirata · 🌌 Voz del cosmos · 🧚 Bosque encantado · 💪 Coach de confianza · 🎓 Profesor claro.

**Plantillas** (en Objetivos → Nuevo): 🏴‍☠️ Soñar que soy pirata · 🕊️ Soñar que vuelo · 🚀 Viajar por el espacio · 🌊 Calma profunda · 💪 Confianza en mí · 🇬🇧 Vocabulario de inglés. Cada una crea el objetivo completo: guiones con su voz y estilo, señal sonora y fondo sonoro.

## Modo dormir (anti-doomscrolling)

En la app de Android, basado en el **uso** del teléfono y no en horarios (`FocusLogic.java`, con tests JUnit):

```
inactivo ──botón──▶ cuenta atrás ──▶ durmiendo ──primer desbloqueo tras el sueño mínimo──▶ mañana ──reto──▶ inactivo
```

- **Botón «Modo dormir»** en el panel de ajustes rápidos (`SleepTileService`) y en la app; empezar una sesión nocturna también lo activa. Tras la cuenta atrás (30 min por defecto), las apps elegidas se pausan (se preseleccionan Instagram, TikTok, YouTube, X, Reddit… si están instaladas).
- **Madrugada**: desbloquear antes del sueño mínimo (5 h por defecto) no cuenta como despertar; las apps siguen en pausa. De noche hay *fricción* (abrir igual tras una pausa para respirar, con permiso de unos minutos) o modo *estricto*.
- **Despertar por uso**: el primer desbloqueo tras el sueño mínimo abre el reto de la mañana: **caminar N pasos** (acelerómetro) o **anotar el sueño** en el diario. No hay tope de tiempo ni permisos temporales: dormir más no desbloquea nada.
- **Anti volver a dormir**: por la mañana, si la pantalla se queda apagada unos minutos (5 por defecto), suena una alarma (`setAlarmClock`, volumen creciente y vibración) que se repite hasta superar el reto. Una sola vez por noche, y solo hasta 1 h 30 después del sueño mínimo, se puede decir «aún es de madrugada» y seguir durmiendo.
- Teléfono, emergencias, SMS, reloj, ajustes y el escritorio **nunca** se pausan. Estadísticas de aperturas evitadas en 7 días.

**Cómo funciona:** mientras el modo está activo, un servicio en primer plano (`FocusMonitorService`, con notificación) escucha el desbloqueo de pantalla y, solo con la pantalla encendida, consulta con el *acceso de uso* qué app está delante (únicamente el nombre del paquete). Si está en pausa, abre hiSleeper encima gracias a *mostrar sobre otras apps*, o la cubre con una capa propia si el sistema no lo permite. El estado vive en Android, así que funciona con la app cerrada y sobrevive a reinicios (`FocusAlarmReceiver`).

> **¿Por qué no un servicio de accesibilidad?** Google Play Protect (protección mejorada contra fraude) impide instalar fuera de Play Store apps que lo declaren. El acceso de uso y mostrar sobre otras apps no están en esa lista.

**Activarlo:** la configuración lleva a cada ajuste (*Acceso de uso* y *Mostrar sobre otras apps*) y ofrece añadir el botón al panel rápido (Android 13+; en versiones anteriores: panel → ✎ → arrastrar «Modo dormir»).

## App de Android (APK)

Además de la versión web, hiSleeper se empaqueta como app nativa de Android con [Capacitor](https://capacitorjs.com). La app nativa añade:

- **Audio con la pantalla apagada**: un servicio en primer plano (`SleepService`, tipo *mediaPlayback*) con *wake lock* parcial mantiene la app viva toda la noche. Se ve una notificación «sesión nocturna».
- **Voz sintética del sistema** (plugin `@capacitor-community/text-to-speech`), porque el WebView de Android no trae la Web Speech API.
- La pantalla solo se mantiene encendida si el detector de movimiento está activo (el acelerómetro solo llega con la pantalla encendida).

**Instalar:** descarga `hiSleeper.apk` de la release [`apk-latest`](../../releases/tag/apk-latest) (la genera el workflow `android.yml` en cada push a `main`), ábrelo en el móvil y permite «instalar apps de origen desconocido».

**Compilar en local** (requiere JDK 21 y el SDK de Android):

```bash
npm run build && npx cap sync android
cd android && ./gradlew assembleDebug   # → app/build/outputs/apk/debug/app-debug.apk
```

El APK se firma con `android/app/debug.keystore` (llave de depuración con contraseña pública `android`), incluida a propósito para que cada versión se instale encima de la anterior sin perder datos. Para publicar en Google Play hace falta generar una llave privada.

## Desarrollo

```bash
npm install
npm run dev       # servidor local
npm test          # pruebas del modelo de sueño y del reproductor nocturno
npm run build     # build de producción en dist/
```

Stack: Vite + React + TypeScript, Web Audio API, MediaRecorder, Web Speech API, IndexedDB y service worker.

### Publicarla
El workflow `.github/workflows/pages.yml` la publica en GitHub Pages al hacer push a `main` (activa *Settings → Pages → Source: GitHub Actions*). Ábrela en el móvil y usa «Añadir a pantalla de inicio».

## Limitaciones
- Las fases son una **estimación**, no una medición (no hay EEG).
- La voz sintética no pasa por el AudioContext: sin fundidos, y algunos móviles ignoran su volumen. Para la noche, mejor tu voz grabada.
- En la versión web, el navegador detiene el audio si se bloquea la pantalla: deja la app abierta (la pantalla queda negra). La app de Android no tiene esta limitación.
- No es un dispositivo médico.

## Créditos y licencias de terceros
- [onnxruntime-web](https://github.com/microsoft/onnxruntime) (MIT), incluido en la app.
- Voces de [Piper](https://github.com/rhasspy/piper) ([modelos](https://huggingface.co/rhasspy/piper-voices), cada uno con su licencia en su MODEL_CARD), descargadas en el dispositivo.
- [Supertonic 3](https://huggingface.co/Supertone/supertonic-3) (modelo OpenRAIL-M; código de ejemplo MIT, del que se adaptan la normalización de texto y el pipeline), descargado en el dispositivo; versión int8 de [soniqo](https://huggingface.co/soniqo/Supertonic-3-ONNX-INT8) en Android. ONNX Runtime para Android (MIT).
- Fonemizador [piper-phonemize](https://github.com/rhasspy/piper-phonemize) con [eSpeak NG](https://github.com/espeak-ng/espeak-ng) (GPL-3.0), compilado a wasm por [@diffusionstudio/piper-wasm](https://www.npmjs.com/package/@diffusionstudio/piper-wasm); no se distribuye con el código: el dispositivo lo descarga al activar las voces neuronales.

## Estructura
```
src/lib/schedule.ts      modelo de ciclos, ventanas y envolventes (puro, con tests)
src/lib/night.ts         NightRunner: decide qué suena y cuándo
src/lib/audio/engine.ts  motor Web Audio (fondo generativo, pistas, TTS, keep-alive iOS)
src/lib/audio/synth.ts   señales sonoras generadas en el dispositivo
src/lib/audio/soundscape/ fondos generativos: DSP puro (con tests) y su AudioWorklet
src/lib/device.ts        grabadora, Wake Lock, detector de movimiento
src/lib/ai/               guionista con Gemini (guiones y objetivos completos)
src/lib/tts/              voces IA: Supertonic (worker web / plugin nativo), Piper, Gemini, posproducción, estilos y plantillas
src/lib/focus.ts         configuración del modo dormir y detector de pasos (con tests)
src/lib/focusBridge.ts   puente con el modo dormir nativo (estado, botón, retos)
src/lib/native.ts        puente con Android (sesión nocturna nativa, voz del sistema)
android/                 proyecto Android de Capacitor (SleepSession; modo dormir: máquina de estados, monitor, alarmas, botón del panel)
src/lib/db.ts            IndexedDB
src/screens/             Noche, modo noche, Objetivos, Preparación, Pistas, Diario, Guía
```
