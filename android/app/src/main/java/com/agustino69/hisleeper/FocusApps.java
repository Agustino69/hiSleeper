package com.agustino69.hisleeper;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.provider.Telephony;
import android.telecom.TelecomManager;
import java.util.HashSet;
import java.util.Set;

/** Utilidades sobre apps instaladas. */
final class FocusApps {
    private FocusApps() {}

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
