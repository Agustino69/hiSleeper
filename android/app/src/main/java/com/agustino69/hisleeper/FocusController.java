package com.agustino69.hisleeper;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.service.quicksettings.TileService;
import androidx.core.content.ContextCompat;

/** Punto único para cambiar el modo dormir: botón del panel, app, alarmas y servicio. */
final class FocusController {
    private FocusController() {}

    static final String ACTION_TICK = "com.agustino69.hisleeper.focus.TICK";
    static final String ACTION_RING = "com.agustino69.hisleeper.focus.RING";
    static final String ACTION_CANCEL = "com.agustino69.hisleeper.focus.CANCEL";

    static FocusLogic.State start(Context ctx, int windDownMin) {
        FocusStore store = new FocusStore(ctx);
        FocusLogic.State s = FocusLogic.start(System.currentTimeMillis(), windDownMin * 60000L);
        store.setState(s);
        store.setScreenOffAt(0);
        changed(ctx);
        return s;
    }

    static void cancel(Context ctx) {
        FocusStore store = new FocusStore(ctx);
        store.setState(FocusLogic.cancel(store.state()));
        changed(ctx);
    }

    static void completeMorning(Context ctx) {
        FocusStore store = new FocusStore(ctx);
        store.setState(FocusLogic.completeMorning(store.state()));
        changed(ctx);
    }

    static boolean backToSleep(Context ctx) {
        FocusStore store = new FocusStore(ctx);
        FocusLogic.State before = store.state();
        FocusLogic.State after = FocusLogic.backToSleep(before, System.currentTimeMillis(), store.config());
        store.setState(after);
        changed(ctx);
        return after.phase != before.phase;
    }

    /** Estado actual tras aplicar el paso del tiempo (y guardarlo si cambió). */
    static FocusLogic.State current(Context ctx) {
        FocusStore store = new FocusStore(ctx);
        FocusLogic.State s = FocusLogic.tick(store.state(), System.currentTimeMillis());
        if (store.setState(s)) changed(ctx);
        return s;
    }

    /** Tras cualquier cambio: servicio, alarmas y botón del panel al día. */
    static void changed(Context ctx) {
        FocusStore store = new FocusStore(ctx);
        FocusLogic.State s = store.state();
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        am.cancel(pending(ctx, ACTION_TICK));
        if (s.phase == FocusLogic.Phase.IDLE) {
            cancelRing(ctx);
            ctx.stopService(new Intent(ctx, FocusMonitorService.class));
        } else {
            if (s.phase == FocusLogic.Phase.WIND_DOWN) setExact(ctx, s.sleepAt, pending(ctx, ACTION_TICK));
            if (s.phase != FocusLogic.Phase.MORNING) cancelRing(ctx);
            Intent i = new Intent(ctx, FocusMonitorService.class);
            try {
                ContextCompat.startForegroundService(ctx, i);
            } catch (Exception ignored) {
                // Android no deja arrancarlo ahora desde segundo plano; se reintenta al abrir la app.
            }
        }
        if (Build.VERSION.SDK_INT >= 24) {
            TileService.requestListeningState(ctx, new ComponentName(ctx, SleepTileService.class));
        }
    }

    /** La alarma anti-sueño usa setAlarmClock: suena aunque el teléfono esté en reposo profundo. */
    static void scheduleRing(Context ctx, long at) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        PendingIntent show = PendingIntent.getActivity(
            ctx,
            3,
            new Intent(ctx, MainActivity.class),
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );
        try {
            am.setAlarmClock(new AlarmManager.AlarmClockInfo(at, show), pending(ctx, ACTION_RING));
        } catch (SecurityException e) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending(ctx, ACTION_RING));
        }
    }

    static void cancelRing(Context ctx) {
        ((AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE)).cancel(pending(ctx, ACTION_RING));
        FocusMonitorService.stopRingingIfRunning();
    }

    static PendingIntent pending(Context ctx, String action) {
        return PendingIntent.getBroadcast(
            ctx,
            action.hashCode(),
            new Intent(ctx, FocusAlarmReceiver.class).setAction(action),
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );
    }

    private static void setExact(Context ctx, long at, PendingIntent pi) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        boolean exact = Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms();
        if (exact) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
        else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
    }
}
