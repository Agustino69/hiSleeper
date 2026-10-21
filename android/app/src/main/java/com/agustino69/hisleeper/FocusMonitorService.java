package com.agustino69.hisleeper;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.app.usage.UsageEvents;
import android.app.usage.UsageStatsManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ServiceInfo;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import java.text.DateFormat;
import java.util.Date;
import java.util.Set;

/**
 * Durante una ventana de bloqueo comprueba qué app está en primer plano (acceso
 * de uso: solo el nombre del paquete) y, si está bloqueada, abre hiSleeper encima.
 * Solo consulta con la pantalla encendida y se detiene sola al acabar la ventana.
 */
public class FocusMonitorService extends Service {
    private static final String CHANNEL = "focus_monitor";
    private static final int NOTIFICATION_ID = 7310;
    private static final long POLL_MS = 700;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private long lastQuery = 0;
    private String foreground = null;
    private String lastBlocked = null;
    private long lastBlockedAt = 0;
    private View overlay = null;
    private boolean polling = false;

    private final BroadcastReceiver screen = new BroadcastReceiver() {
        @Override
        public void onReceive(Context c, Intent i) {
            if (Intent.ACTION_SCREEN_OFF.equals(i.getAction())) stopPolling();
            else startPolling();
        }
    };

    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            if (!polling) return;
            check();
            handler.postDelayed(this, POLL_MS);
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Sin pantallas en la cama", NotificationManager.IMPORTANCE_MIN);
            ch.setShowBadge(false);
            getSystemService(NotificationManager.class).createNotificationChannel(ch);
        }
        IntentFilter f = new IntentFilter(Intent.ACTION_SCREEN_OFF);
        f.addAction(Intent.ACTION_SCREEN_ON);
        registerReceiver(screen, f);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        FocusStore store = new FocusStore(this);
        FocusLogic.Window w = FocusLogic.active(store.windows(), System.currentTimeMillis(), store.unlocked());
        String until = w != null ? DateFormat.getTimeInstance(DateFormat.SHORT).format(new Date(w.end)) : "";
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        Notification n = new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_moon)
            .setContentTitle("Sin pantallas en la cama")
            .setContentText(w != null ? "Apps en pausa hasta las " + until : "Apps en pausa")
            .setContentIntent(PendingIntent.getActivity(this, 1, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT))
            .setOngoing(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .build();
        int type = Build.VERSION.SDK_INT >= 34 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE : 0;
        ServiceCompat.startForeground(this, NOTIFICATION_ID, n, type);
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        if (pm.isInteractive()) startPolling();
        return START_STICKY;
    }

    private void startPolling() {
        if (polling) return;
        polling = true;
        // Sin dato previo, se mira la última hora para saber qué app quedó delante.
        lastQuery = System.currentTimeMillis() - (foreground == null ? 3600000 : 5000);
        handler.post(tick);
    }

    private void stopPolling() {
        polling = false;
        handler.removeCallbacks(tick);
    }

    private void check() {
        FocusStore store = new FocusStore(this);
        long now = System.currentTimeMillis();
        if (!store.enabled() || FocusLogic.active(store.windows(), now, store.unlocked()) == null) {
            // Fin de la ventana (o desbloqueo): nada más que hacer hasta la siguiente.
            FocusScheduler.scheduleNext(this);
            stopSelf();
            return;
        }
        UsageStatsManager usm = (UsageStatsManager) getSystemService(USAGE_STATS_SERVICE);
        UsageEvents events = usm.queryEvents(lastQuery, now);
        lastQuery = now;
        UsageEvents.Event e = new UsageEvents.Event();
        while (events.hasNextEvent()) {
            events.getNextEvent(e);
            if (e.getEventType() == UsageEvents.Event.MOVE_TO_FOREGROUND) foreground = e.getPackageName();
        }
        if (foreground == null || foreground.equals(getPackageName())) {
            removeOverlay();
            return;
        }
        Set<String> exempt = FocusApps.exemptPackages(this);
        boolean block = FocusLogic.shouldBlock(
            foreground,
            store.packages(),
            exempt,
            store.windows(),
            now,
            store.unlocked(),
            store.allowedUntil(foreground)
        );
        if (!block) {
            removeOverlay();
            return;
        }
        if (foreground.equals(lastBlocked) && now - lastBlockedAt < 2500) {
            // Si a pesar de abrir hiSleeper la app sigue delante, se cubre con una capa.
            if (now - lastBlockedAt > 1200) showOverlay(foreground);
            return;
        }
        lastBlocked = foreground;
        lastBlockedAt = now;
        FocusLogic.Window w = FocusLogic.active(store.windows(), now, store.unlocked());
        String kind = w != null ? w.kind : "night";
        String label = FocusApps.labelOf(this, foreground);
        store.logAttempt(foreground, label, kind, now);
        try {
            startActivity(blockedIntent(foreground, label, kind));
        } catch (Exception ex) {
            showOverlay(foreground);
        }
    }

    private Intent blockedIntent(String pkg, String label, String kind) {
        return new Intent(this, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
            .putExtra(FocusPlugin.EXTRA_PACKAGE, pkg)
            .putExtra(FocusPlugin.EXTRA_LABEL, label)
            .putExtra(FocusPlugin.EXTRA_KIND, kind);
    }

    /** Capa de respaldo por si el sistema no deja abrir hiSleeper encima. */
    private void showOverlay(String pkg) {
        if (overlay != null || !Settings.canDrawOverlays(this)) return;
        WindowManager wm = (WindowManager) getSystemService(WINDOW_SERVICE);
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        box.setBackgroundColor(Color.rgb(11, 13, 26));
        int pad = dp(32);
        box.setPadding(pad, pad, pad, pad);
        TextView moon = new TextView(this);
        moon.setText("🌙");
        moon.setTextSize(TypedValue.COMPLEX_UNIT_SP, 56);
        moon.setGravity(Gravity.CENTER);
        TextView msg = new TextView(this);
        msg.setText(FocusApps.labelOf(this, pkg) + " está en pausa.\nEs hora de desconectar.");
        msg.setTextColor(Color.rgb(231, 228, 242));
        msg.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
        msg.setGravity(Gravity.CENTER);
        msg.setPadding(0, dp(16), 0, dp(24));
        Button open = new Button(this);
        open.setText("Abrir hiSleeper");
        open.setOnClickListener(v -> {
            removeOverlay();
            startActivity(blockedIntent(pkg, FocusApps.labelOf(this, pkg), "night"));
        });
        box.addView(moon);
        box.addView(msg);
        box.addView(open);
        WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.OPAQUE
        );
        try {
            wm.addView(box, lp);
            overlay = box;
        } catch (Exception ignored) {}
    }

    private void removeOverlay() {
        if (overlay == null) return;
        try {
            ((WindowManager) getSystemService(WINDOW_SERVICE)).removeView(overlay);
        } catch (Exception ignored) {}
        overlay = null;
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    @Override
    public void onDestroy() {
        stopPolling();
        removeOverlay();
        try {
            unregisterReceiver(screen);
        } catch (Exception ignored) {}
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
