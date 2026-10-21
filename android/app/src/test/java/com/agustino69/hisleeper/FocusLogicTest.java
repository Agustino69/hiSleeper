package com.agustino69.hisleeper;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.junit.Test;

public class FocusLogicTest {
    private final List<FocusLogic.Window> windows = Arrays.asList(
        new FocusLogic.Window("night-1", "night", 1000, 5000),
        new FocusLogic.Window("morning-1", "morning", 5000, 8000),
        new FocusLogic.Window("session-morning-a", "morning", 4000, 7000)
    );
    private final Set<String> blocked = new HashSet<>(Arrays.asList("com.instagram.android"));
    private final Set<String> exempt = new HashSet<>(Arrays.asList("com.android.settings"));
    private final Set<String> none = Collections.emptySet();

    @Test
    public void bloqueaSoloAppsElegidasDentroDeUnaVentana() {
        assertTrue(FocusLogic.shouldBlock("com.instagram.android", blocked, exempt, windows, 2000, none, 0));
        assertFalse(FocusLogic.shouldBlock("com.whatsapp", blocked, exempt, windows, 2000, none, 0));
        assertFalse(FocusLogic.shouldBlock("com.instagram.android", blocked, exempt, windows, 9000, none, 0));
    }

    @Test
    public void lasExentasNuncaSeBloquean() {
        Set<String> all = new HashSet<>(blocked);
        all.add("com.android.settings");
        assertFalse(FocusLogic.shouldBlock("com.android.settings", all, exempt, windows, 2000, none, 0));
    }

    @Test
    public void permisoTemporalYDesbloqueo() {
        assertFalse(FocusLogic.shouldBlock("com.instagram.android", blocked, exempt, windows, 2000, none, 2500));
        Set<String> unlocked = new HashSet<>(Arrays.asList("morning-1", "session-morning-a"));
        assertFalse(FocusLogic.shouldBlock("com.instagram.android", blocked, exempt, windows, 6000, unlocked, 0));
    }

    @Test
    public void laMananaTienePrioridad() {
        assertEquals("session-morning-a", FocusLogic.active(windows, 4500, none).id);
        assertEquals("night-1", FocusLogic.active(windows, 2000, none).id);
        assertNull(FocusLogic.active(windows, 500, none));
    }

    @Test
    public void proximoInicioParaProgramarLaAlarma() {
        assertEquals(1000, FocusLogic.nextStart(windows, 0));
        assertEquals(5000, FocusLogic.nextStart(windows, 4500));
        assertEquals(0, FocusLogic.nextStart(windows, 9000));
    }
}
