package com.agustino69.hisleeper;

import android.accessibilityservice.AccessibilityService;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.os.Build;
import android.provider.Telephony;
import android.telecom.TelecomManager;
import android.view.accessibility.AccessibilityEvent;
import java.util.HashSet;
import java.util.Set;

/**
 * Detecta qué app pasa a primer plano (solo el nombre del paquete; no lee el
 * contenido de la pantalla) y, si está bloqueada en este momento, abre hiSleeper.
 */
public class FocusAccessibilityService extends AccessibilityService {
    private String lastPkg = null;
    private long lastAt = 0;

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (event == null || event.getEventType() != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return;
        CharSequence cs = event.getPackageName();
        if (cs == null) return;
        String pkg = cs.toString();
        if (pkg.equals(getPackageName())) return;

        FocusStore store = new FocusStore(this);
        if (!store.enabled()) return;
        long now = System.currentTimeMillis();
        boolean block = FocusLogic.shouldBlock(
            pkg,
            store.packages(),
            exemptPackages(this),
            store.windows(),
            now,
            store.unlocked(),
            store.allowedUntil(pkg)
        );
        if (!block) return;
        // Varias ventanas de la misma app llegan seguidas: un solo bloqueo.
        if (pkg.equals(lastPkg) && now - lastAt < 1500) return;
        lastPkg = pkg;
        lastAt = now;

        FocusLogic.Window w = FocusLogic.active(store.windows(), now, store.unlocked());
        String kind = w != null ? w.kind : "night";
        String label = labelOf(this, pkg);
        store.logAttempt(pkg, label, kind, now);

        Intent i = new Intent(this, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
            .putExtra(FocusPlugin.EXTRA_PACKAGE, pkg)
            .putExtra(FocusPlugin.EXTRA_LABEL, label)
            .putExtra(FocusPlugin.EXTRA_KIND, kind);
        startActivity(i);
    }

    @Override
    public void onInterrupt() {}

    static String labelOf(Context ctx, String pkg) {
        try {
            PackageManager pm = ctx.getPackageManager();
            return pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString();
        } catch (Exception e) {
            return pkg;
        }
    }

    /** Apps que nunca se bloquean: llamadas, emergencias, SMS, reloj, ajustes y el escritorio. */
    static Set<String> exemptPackages(Context ctx) {
        Set<String> s = new HashSet<>();
        s.add(ctx.getPackageName());
        s.add("com.android.settings");
        s.add("com.android.systemui");
        s.add("com.android.phone");
        s.add("com.android.server.telecom");
        s.add("com.android.emergency");
        s.add("com.google.android.dialer");
        s.add("com.android.dialer");
        s.add("com.google.android.deskclock");
        s.add("com.android.deskclock");
        s.add("com.sec.android.app.clockpackage");
        try {
            TelecomManager tm = (TelecomManager) ctx.getSystemService(Context.TELECOM_SERVICE);
            if (tm != null && tm.getDefaultDialerPackage() != null) s.add(tm.getDefaultDialerPackage());
        } catch (Exception ignored) {}
        try {
            String sms = Telephony.Sms.getDefaultSmsPackage(ctx);
            if (sms != null) s.add(sms);
        } catch (Exception ignored) {}
        Intent home = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME);
        for (ResolveInfo ri : ctx.getPackageManager().queryIntentActivities(home, 0)) {
            if (ri.activityInfo != null) s.add(ri.activityInfo.packageName);
        }
        return s;
    }
}
