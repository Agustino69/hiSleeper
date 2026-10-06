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
- Ruido de fondo (rosa, marrón, oleaje, blanco) en bucle sin cortes, que enmascara las pistas.
- Intervalos con variación aleatoria (evita la habituación).
- **Detector de movimiento** (acelerómetro, móvil sobre el colchón): pausa las pistas y baja el volumen el resto de la noche.
- Pantalla negra con *Wake Lock* para que el navegador no detenga el audio; despertador suave opcional.

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

## Estructura
```
src/lib/schedule.ts      modelo de ciclos, ventanas y envolventes (puro, con tests)
src/lib/night.ts         NightRunner: decide qué suena y cuándo
src/lib/audio/engine.ts  motor Web Audio (ruido, pistas, TTS, keep-alive iOS)
src/lib/audio/synth.ts   señales sonoras y ruidos generados en el dispositivo
src/lib/device.ts        grabadora, Wake Lock, detector de movimiento
src/lib/native.ts        puente con Android (sesión nocturna nativa, voz del sistema)
android/                 proyecto Android de Capacitor (SleepSessionPlugin, SleepService)
src/lib/db.ts            IndexedDB
src/screens/             Noche, modo noche, Objetivos, Preparación, Pistas, Diario, Guía
```
