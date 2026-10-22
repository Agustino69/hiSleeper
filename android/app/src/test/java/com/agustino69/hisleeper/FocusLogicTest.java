package com.agustino69.hisleeper;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import com.agustino69.hisleeper.FocusLogic.Config;
import com.agustino69.hisleeper.FocusLogic.Phase;
import com.agustino69.hisleeper.FocusLogic.State;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import org.junit.Test;

public class FocusLogicTest {
    private static final long MIN = 60000L;
    private static final long H = 60 * MIN;
    private final Config cfg = new Config(5 * H, 5 * MIN, true);
    private final Set<String> blocked = new HashSet<>(Arrays.asList("com.instagram.android"));
    private final Set<String> exempt = new HashSet<>(Arrays.asList("com.android.settings"));
    private static final String IG = "com.instagram.android";

    /** 23:00 se pulsa el botón con 30 min de cuenta atrás. */
    private final long t0 = 1_000_000_000L;
    private final State started = FocusLogic.start(t0, 30 * MIN);

    @Test
    public void laCuentaAtrasNoBloqueaYLuegoSi() {
        assertEquals(Phase.WIND_DOWN, started.phase);
        assertFalse(FocusLogic.shouldBlock(IG, blocked, exempt, started, t0 + 10 * MIN, 0));
        assertTrue(FocusLogic.shouldBlock(IG, blocked, exempt, started, t0 + 31 * MIN, 0));
        assertEquals(Phase.SLEEP, FocusLogic.tick(started, t0 + 31 * MIN).phase);
    }

    @Test
    public void sinCuentaAtrasDuermeYa() {
        assertEquals(Phase.SLEEP, FocusLogic.start(t0, 0).phase);
    }

    @Test
    public void desbloquearDeMadrugadaNoEsDespertar() {
        State s = FocusLogic.onUnlock(started, t0 + 3 * H, cfg);
        assertEquals(Phase.SLEEP, s.phase);
        assertTrue(FocusLogic.shouldBlock(IG, blocked, exempt, s, t0 + 3 * H, 0));
    }

    @Test
    public void elPrimerDesbloqueoTrasElSuenoMinimoEsLaManana() {
        long wake = t0 + 30 * MIN + 7 * H;
        State s = FocusLogic.onUnlock(started, wake, cfg);
        assertEquals(Phase.MORNING, s.phase);
        assertEquals(wake, s.morningAt);
        assertEquals("morning", FocusLogic.kind(s));
    }

    @Test
    public void laMananaNoCaducaConElTiempoNiAceptaPermisosTemporales() {
        State s = FocusLogic.onUnlock(started, t0 + 8 * H, cfg);
        // Dormir otra hora (o diez) no desbloquea.
        assertTrue(FocusLogic.shouldBlock(IG, blocked, exempt, s, t0 + 18 * H, 0));
        assertTrue(FocusLogic.shouldBlock(IG, blocked, exempt, s, t0 + 8 * H, t0 + 9 * H));
        assertEquals(Phase.MORNING, FocusLogic.cancel(s).phase);
        assertEquals(Phase.IDLE, FocusLogic.completeMorning(s).phase);
    }

    @Test
    public void deNochePermisoTemporalConFriccion() {
        State s = FocusLogic.tick(started, t0 + H);
        assertFalse(FocusLogic.shouldBlock(IG, blocked, exempt, s, t0 + H, t0 + H + 5 * MIN));
        assertFalse(FocusLogic.shouldBlock("com.android.settings", blocked, exempt, s, t0 + H, 0));
        assertFalse(FocusLogic.shouldBlock("com.whatsapp", blocked, exempt, s, t0 + H, 0));
    }

    @Test
    public void volverADormirUnaVezYSoloDeMadrugada() {
        long early = t0 + 30 * MIN + 5 * H + 20 * MIN; // pasado el sueño mínimo, aún de madrugada
        State m = FocusLogic.onUnlock(started, early, cfg);
        assertEquals(Phase.MORNING, m.phase);
        assertTrue(FocusLogic.canGoBackToSleep(m, early, cfg));
        State back = FocusLogic.backToSleep(m, early, cfg);
        assertEquals(Phase.SLEEP, back.phase);
        // El siguiente desbloqueo ya es la mañana definitiva, sin segunda oportunidad.
        State m2 = FocusLogic.onUnlock(back, early + 2 * H, cfg);
        assertEquals(Phase.MORNING, m2.phase);
        assertFalse(FocusLogic.canGoBackToSleep(m2, early + 2 * H, cfg));

        long late = t0 + 30 * MIN + 8 * H;
        State real = FocusLogic.onUnlock(started, late, cfg);
        assertFalse(FocusLogic.canGoBackToSleep(real, late, cfg));
        assertEquals(Phase.MORNING, FocusLogic.backToSleep(real, late, cfg).phase);
    }

    @Test
    public void alarmaSiLaPantallaSeQuedaApagadaPorLaManana() {
        long wake = t0 + 8 * H;
        State m = FocusLogic.onUnlock(started, wake, cfg);
        long off = wake + 2 * MIN;
        assertEquals(off + 5 * MIN, FocusLogic.ringAt(m, off, cfg));
        assertEquals(0, FocusLogic.ringAt(m, off, new Config(5 * H, 5 * MIN, false)));
        assertEquals(0, FocusLogic.ringAt(FocusLogic.tick(started, wake), off, cfg));
    }

    @Test
    public void unModoOlvidadoSeCancelaSolo() {
        assertEquals(Phase.IDLE, FocusLogic.tick(started, t0 + 21 * H).phase);
    }
}
