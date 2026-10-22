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
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
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

/**
 * Corre mientras el modo dormir está activo. Con la pantalla encendida mira qué
 * app está delante (acceso de uso: solo el nombre del paquete) y pausa las elegidas.
 * Detecta el despertar por uso (primer desbloqueo tras el sueño mínimo) y, si por la
 * mañana la pantalla se queda apagada, hace sonar la alarma anti-sueño.
 */
public class FocusMonitorService extends Service {
    static final String ACTION_RING = "ring";
    static final String ACTION_STOP_RING = "stopRing";
    private static final String CHANNEL = "focus_monitor";
    private static final int NOTIFICATION_ID = 7310;
    private static final long POLL_MS = 700;

    private static FocusMonitorService instance;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private long lastQuery = 0;
    private String foreground = null;
    private String lastBlocked = null;
    private long lastBlockedAt = 0;
    private View overlay = null;
    private boolean polling = false;
    private MediaPlayer player = null;
    private float ringVolume = 0.2f;

    private final BroadcastReceiver screen = new BroadcastReceiver() {
        @Override
        public void onReceive(Context c, Intent i) {
            String a = i.getAction();
            if (Intent.ACTION_SCREEN_OFF.equals(a)) onScreenOff();
            else if (Intent.ACTION_SCREEN_ON.equals(a)) startPolling();
            else if (Intent.ACTION_USER_PRESENT.equals(a)) onUnlock();
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

    private final Runnable rampUp = new Runnable() {
        @Override
        public void run() {
            if (player == null) return;
            ringVolume = Math.min(1f, ringVolume + 0.1f);
            player.setVolume(ringVolume, ringVolume);
            if (ringVolume < 1f) handler.postDelayed(this, 3000);
        }
    };

    static void stopRingingIfRunning() {
        if (instance != null) instance.stopRinging();
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Modo dormir", NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            ch.setSound(null, null);
            getSystemService(NotificationManager.class).createNotificationChannel(ch);
        }
        IntentFilter f = new IntentFilter(Intent.ACTION_SCREEN_OFF);
        f.addAction(Intent.ACTION_SCREEN_ON);
        f.addAction(Intent.ACTION_USER_PRESENT);
        registerReceiver(screen, f);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        FocusLogic.State s = FocusController.current(this);
        int type = Build.VERSION.SDK_INT >= 34 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE : 0;
        ServiceCompat.startForeground(this, NOTIFICATION_ID, notification(s), type);
        if (s.phase == FocusLogic.Phase.IDLE) {
            stopSelf();
            return START_NOT_STICKY;
        }
        String action = intent != null ? intent.getAction() : null;
        if (ACTION_RING.equals(action)) startRinging();
        else if (ACTION_STOP_RING.equals(action)) stopRinging();
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        if (pm.isInteractive()) startPolling();
        return START_STICKY;
    }

    private Notification notification(FocusLogic.State s) {
        DateFormat hm = DateFormat.getTimeInstance(DateFormat.SHORT);
        String title;
        String text;
        switch (s.phase) {
            case WIND_DOWN:
                title = "Modo dormir en marcha";
                text = "Tus apps se pausan a las " + hm.format(new Date(s.sleepAt)) + ". Ve preparándote.";
                break;
            case MORNING:
                title = "¡Buenos días! Levántate";
                FocusStore st = new FocusStore(this);
                text = "journal".equals(st.challenge())
                    ? "Anota tu sueño en el diario para desbloquear tus apps."
                    : "Camina " + st.steps() + " pasos para desbloquear tus apps.";
                break;
            default:
                title = "Modo dormir";
                text = "Apps en pausa hasta que te levantes.";
        }
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_moon)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(PendingIntent.getActivity(this, 1, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT))
            .setOngoing(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_LOW);
        if (s.phase == FocusLogic.Phase.WIND_DOWN || s.phase == FocusLogic.Phase.SLEEP) {
            b.addAction(0, "Cancelar", FocusController.pending(this, FocusController.ACTION_CANCEL));
        }
        return b.build();
    }

    private void refreshNotification() {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        nm.notify(NOTIFICATION_ID, notification(new FocusStore(this).state()));
    }

    // ── Pantalla y desbloqueo ──

    private void onScreenOff() {
        stopPolling();
        FocusStore store = new FocusStore(this);
        long now = System.currentTimeMillis();
        store.setScreenOffAt(now);
        FocusLogic.State s = FocusController.current(this);
        long at = FocusLogic.ringAt(s, now, store.config());
        // Por la mañana, si la pantalla sigue apagada (volviste a la cama), suena la alarma.
        if (at > 0) FocusController.scheduleRing(this, at);
    }

    private void onUnlock() {
        FocusStore store = new FocusStore(this);
        long now = System.currentTimeMillis();
        FocusLogic.State before = FocusController.current(this);
        FocusLogic.State after = FocusLogic.onUnlock(before, now, store.config());
        store.setState(after);
        store.setScreenOffAt(0);
        FocusController.cancelRing(this);
        if (after.phase == FocusLogic.Phase.MORNING) {
            refreshNotification();
            // El despertar se detecta por uso: el primer desbloqueo tras dormir abre el reto.
            openHiSleeper(null, null, "morning");
        }
        startPolling();
    }

    // ── Alarma anti-sueño ──

    private void startRinging() {
        if (player != null) return;
        try {
            Uri uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
            if (uri == null) uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
            player = new MediaPlayer();
            player.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
            player.setDataSource(this, uri);
            player.setLooping(true);
            ringVolume = 0.2f;
            player.setVolume(ringVolume, ringVolume);
            player.prepare();
            player.start();
            handler.postDelayed(rampUp, 3000);
        } catch (Exception e) {
            player = null;
        }
        Vibrator v = (Vibrator) getSystemService(VIBRATOR_SERVICE);
        if (v != null) {
            long[] pattern = { 0, 600, 600 };
            if (Build.VERSION.SDK_INT >= 26) v.vibrate(VibrationEffect.createWaveform(pattern, 0));
            else v.vibrate(pattern, 0);
        }
    }

    void stopRinging() {
        handler.removeCallbacks(rampUp);
        if (player != null) {
            try {
                player.stop();
            } catch (Exception ignored) {}
            player.release();
            player = null;
        }
        Vibrator v = (Vibrator) getSystemService(VIBRATOR_SERVICE);
        if (v != null) v.cancel();
    }

    // ── Pausa de apps ──

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
        FocusLogic.State s = FocusController.current(this);
        if (s.phase == FocusLogic.Phase.IDLE) {
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
        boolean block = store.enabled() && FocusLogic.shouldBlock(
            foreground,
            store.packages(),
            FocusApps.exemptPackages(this),
            s,
            now,
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
        String kind = FocusLogic.kind(s);
        String label = FocusApps.labelOf(this, foreground);
        store.logAttempt(foreground, label, kind, now);
        if (!openHiSleeper(foreground, label, kind)) showOverlay(foreground);
    }

    private boolean openHiSleeper(String pkg, String label, String kind) {
        Intent i = new Intent(this, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
            .putExtra(FocusPlugin.EXTRA_KIND, kind);
        if (pkg != null) i.putExtra(FocusPlugin.EXTRA_PACKAGE, pkg).putExtra(FocusPlugin.EXTRA_LABEL, label);
        try {
            startActivity(i);
            return true;
        } catch (Exception ex) {
            return false;
        }
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
        msg.setText(FocusApps.labelOf(this, pkg) + " está en pausa.");
        msg.setTextColor(Color.rgb(231, 228, 242));
        msg.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
        msg.setGravity(Gravity.CENTER);
        msg.setPadding(0, dp(16), 0, dp(24));
        Button open = new Button(this);
        open.setText("Abrir hiSleeper");
        open.setOnClickListener(v -> {
            removeOverlay();
            openHiSleeper(pkg, FocusApps.labelOf(this, pkg), FocusLogic.kind(new FocusStore(this).state()));
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
        instance = null;
        stopPolling();
        stopRinging();
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
