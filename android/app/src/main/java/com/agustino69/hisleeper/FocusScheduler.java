package com.agustino69.hisleeper;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import androidx.core.content.ContextCompat;

/**
 * Arranca el monitor al empezar cada ventana de bloqueo. Fuera de las ventanas
 * no hay nada en marcha (cero batería).
 */
final class FocusScheduler {
    private FocusScheduler() {}

    /** Arranca el monitor si hay una ventana activa y programa la siguiente. */
    static void sync(Context ctx) {
        FocusStore store = new FocusStore(ctx);
        long now = System.currentTimeMillis();
        if (store.enabled() && FocusLogic.active(store.windows(), now, store.unlocked()) != null) startMonitor(ctx);
        scheduleNext(ctx);
    }

    static void scheduleNext(Context ctx) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        PendingIntent pi = PendingIntent.getBroadcast(
            ctx,
            0,
            new Intent(ctx, FocusAlarmReceiver.class),
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );
        am.cancel(pi);
        FocusStore store = new FocusStore(ctx);
        if (!store.enabled()) return;
        long next = FocusLogic.nextStart(store.windows(), System.currentTimeMillis());
        if (next <= 0) return;
        boolean exact = Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms();
        if (exact) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, pi);
        else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, pi);
    }

    static void startMonitor(Context ctx) {
        try {
            ContextCompat.startForegroundService(ctx, new Intent(ctx, FocusMonitorService.class));
        } catch (Exception ignored) {
            // Android no permite arrancarlo ahora desde segundo plano; lo hará al abrir la app.
        }
    }
}
