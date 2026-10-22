package com.agustino69.hisleeper;

import java.util.Set;

/**
 * Modo dormir basado en el uso del teléfono (sin horarios fijos):
 *
 *   IDLE ──botón──▶ WIND_DOWN ──cuenta atrás──▶ SLEEP ──desbloqueo tras el sueño mínimo──▶ MORNING ──reto──▶ IDLE
 *
 * - WIND_DOWN: aún se puede usar todo; las apps se pausan al acabar la cuenta atrás.
 * - SLEEP: apps en pausa. Desbloquear de madrugada (antes del sueño mínimo) no cambia nada.
 * - MORNING: el primer desbloqueo tras el sueño mínimo. Las apps siguen en pausa hasta
 *   superar el reto; no hay tope de tiempo, así que dormir más no sirve para desbloquear.
 *   Si la pantalla se queda apagada un rato (volviste a la cama), suena una alarma.
 *
 * Clase pura (sin Android) para poder probarla con JUnit.
 */
public final class FocusLogic {
    private FocusLogic() {}

    public enum Phase {
        IDLE,
        WIND_DOWN,
        SLEEP,
        MORNING,
    }

    /** Margen extra tras el sueño mínimo en el que aún se puede «volver a dormir» (una vez). */
    public static final long BACK_TO_SLEEP_EXTRA_MS = 90 * 60000L;
    /** Si nadie desbloquea en este tiempo (móvil olvidado/apagado), el modo se cancela solo. */
    public static final long MAX_SESSION_MS = 20 * 3600000L;

    public static final class State {
        public final Phase phase;
        public final long startedAt;
        /** Momento en que empiezan a pausarse las apps (fin de la cuenta atrás). */
        public final long sleepAt;
        public final long morningAt;
        public final boolean usedBackToSleep;

        public State(Phase phase, long startedAt, long sleepAt, long morningAt, boolean usedBackToSleep) {
            this.phase = phase;
            this.startedAt = startedAt;
            this.sleepAt = sleepAt;
            this.morningAt = morningAt;
            this.usedBackToSleep = usedBackToSleep;
        }

        public static final State IDLE = new State(Phase.IDLE, 0, 0, 0, false);

        State with(Phase p, long morningAt, boolean usedBack) {
            return new State(p, startedAt, sleepAt, morningAt, usedBack);
        }
    }

    public static final class Config {
        public final long minSleepMs;
        public final long snoozeMs;
        public final boolean antiSnooze;

        public Config(long minSleepMs, long snoozeMs, boolean antiSnooze) {
            this.minSleepMs = minSleepMs;
            this.snoozeMs = snoozeMs;
            this.antiSnooze = antiSnooze;
        }
    }

    public static State start(long now, long windDownMs) {
        long sleepAt = now + Math.max(0, windDownMs);
        return new State(windDownMs > 0 ? Phase.WIND_DOWN : Phase.SLEEP, now, sleepAt, 0, false);
    }

    /** Avance por el paso del tiempo. */
    public static State tick(State s, long now) {
        if (s.phase == Phase.WIND_DOWN && now >= s.sleepAt) s = s.with(Phase.SLEEP, 0, s.usedBackToSleep);
        if (s.phase == Phase.SLEEP && now - s.sleepAt > MAX_SESSION_MS) return State.IDLE;
        return s;
    }

    /** El usuario desbloqueó el teléfono. */
    public static State onUnlock(State s, long now, Config c) {
        s = tick(s, now);
        if (s.phase == Phase.SLEEP && now >= s.sleepAt + c.minSleepMs) return s.with(Phase.MORNING, now, s.usedBackToSleep);
        return s;
    }

    /** Se puede volver a dormir una sola vez por noche, y solo si aún es de madrugada. */
    public static boolean canGoBackToSleep(State s, long now, Config c) {
        return s.phase == Phase.MORNING && !s.usedBackToSleep && now < s.sleepAt + c.minSleepMs + BACK_TO_SLEEP_EXTRA_MS;
    }

    public static State backToSleep(State s, long now, Config c) {
        return canGoBackToSleep(s, now, c) ? s.with(Phase.SLEEP, 0, true) : s;
    }

    /** Cancelar solo es posible antes de la mañana: por la mañana hay que superar el reto. */
    public static State cancel(State s) {
        return s.phase == Phase.MORNING ? s : State.IDLE;
    }

    public static State completeMorning(State s) {
        return s.phase == Phase.MORNING ? State.IDLE : s;
    }

    public static boolean blocksApps(State s) {
        return s.phase == Phase.SLEEP || s.phase == Phase.MORNING;
    }

    public static String kind(State s) {
        return s.phase == Phase.MORNING ? "morning" : "night";
    }

    /** Momento en que debe sonar la alarma anti-sueño (0 = no debe sonar). */
    public static long ringAt(State s, long screenOffAt, Config c) {
        if (s.phase != Phase.MORNING || !c.antiSnooze || screenOffAt <= 0) return 0;
        return Math.max(screenOffAt, s.morningAt) + c.snoozeMs;
    }

    public static boolean shouldBlock(String pkg, Set<String> blocked, Set<String> exempt, State s, long now, long allowedUntil) {
        if (pkg == null || exempt.contains(pkg) || !blocked.contains(pkg)) return false;
        if (!blocksApps(tick(s, now))) return false;
        // En la mañana no hay permisos temporales: el reto es la única salida.
        if (s.phase == Phase.MORNING) return true;
        return allowedUntil <= now;
    }
}
