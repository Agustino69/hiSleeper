package com.agustino69.hisleeper;

import java.util.List;
import java.util.Set;

/**
 * Decide si una app debe bloquearse ahora. Las ventanas (fechas concretas) las
 * calcula la app web; aquí solo se comprueba si «ahora» cae dentro de alguna.
 */
public final class FocusLogic {
    private FocusLogic() {}

    public static final class Window {
        public final String id;
        public final String kind;
        public final long start;
        public final long end;

        public Window(String id, String kind, long start, long end) {
            this.id = id;
            this.kind = kind;
            this.start = start;
            this.end = end;
        }
    }

    /** Ventana activa; la de mañana tiene prioridad (es la que se desbloquea con el reto). */
    public static Window active(List<Window> windows, long now, Set<String> unlocked) {
        Window found = null;
        for (Window w : windows) {
            if (now < w.start || now >= w.end || unlocked.contains(w.id)) continue;
            if ("morning".equals(w.kind)) return w;
            if (found == null) found = w;
        }
        return found;
    }

    public static boolean shouldBlock(
        String pkg,
        Set<String> blocked,
        Set<String> exempt,
        List<Window> windows,
        long now,
        Set<String> unlocked,
        long allowedUntil
    ) {
        if (pkg == null || exempt.contains(pkg) || !blocked.contains(pkg)) return false;
        if (allowedUntil > now) return false;
        return active(windows, now, unlocked) != null;
    }
}
