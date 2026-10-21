package com.agustino69.hisleeper;

import android.app.AlarmManager;
import android.app.AppOpsManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.net.Uri;
import android.os.Build;
import android.os.Process;
import android.provider.Settings;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Puente entre la app web y el bloqueo de apps (servicio de accesibilidad). */
@CapacitorPlugin(name = "Focus")
public class FocusPlugin extends Plugin {
    static final String EXTRA_PACKAGE = "focusBlockedPackage";
    static final String EXTRA_LABEL = "focusBlockedLabel";
    static final String EXTRA_KIND = "focusBlockedKind";

    @Override
    public void load() {
        // Arranque en frío: la app se abrió porque se bloqueó otra.
        if (getActivity() != null) emitBlocked(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        emitBlocked(intent);
    }

    private void emitBlocked(Intent intent) {
        if (intent == null || !intent.hasExtra(EXTRA_PACKAGE)) return;
        JSObject data = new JSObject();
        data.put("package", intent.getStringExtra(EXTRA_PACKAGE));
        data.put("label", intent.getStringExtra(EXTRA_LABEL));
        data.put("kind", intent.getStringExtra(EXTRA_KIND));
        data.put("at", System.currentTimeMillis());
        intent.removeExtra(EXTRA_PACKAGE);
        notifyListeners("blocked", data, true);
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject r = new JSObject();
        r.put("usageAccess", hasUsageAccess());
        r.put("overlay", Settings.canDrawOverlays(getContext()));
        AlarmManager am = (AlarmManager) getContext().getSystemService(Context.ALARM_SERVICE);
        r.put("exactAlarm", Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms());
        r.put("sdk", Build.VERSION.SDK_INT);
        call.resolve(r);
    }

    private boolean hasUsageAccess() {
        AppOpsManager ops = (AppOpsManager) getContext().getSystemService(Context.APP_OPS_SERVICE);
        int mode = Build.VERSION.SDK_INT >= 29
            ? ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), getContext().getPackageName())
            : ops.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), getContext().getPackageName());
        return mode == AppOpsManager.MODE_ALLOWED;
    }

    private void openSettings(PluginCall call, Intent i) {
        try {
            getContext().startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (Exception e) {
            // Algunos fabricantes no tienen la pantalla concreta: se abre la info de la app.
            getContext().startActivity(
                new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            );
        }
        call.resolve();
    }

    /** «Acceso de uso»: permite saber qué app está en primer plano. */
    @PluginMethod
    public void openUsageAccessSettings(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS);
        if (Build.VERSION.SDK_INT >= 29) i.setData(Uri.parse("package:" + getContext().getPackageName()));
        openSettings(call, i);
    }

    /** «Mostrar sobre otras apps»: permite abrir hiSleeper encima de la app bloqueada. */
    @PluginMethod
    public void openOverlaySettings(PluginCall call) {
        openSettings(call, new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getContext().getPackageName())));
    }

    /** «Alarmas y recordatorios»: para empezar el bloqueo a la hora exacta. */
    @PluginMethod
    public void openExactAlarmSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT < 31) {
            call.resolve();
            return;
        }
        openSettings(call, new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + getContext().getPackageName())));
    }

    @PluginMethod
    public void listApps(PluginCall call) {
        new Thread(() -> {
            PackageManager pm = getContext().getPackageManager();
            Intent launcher = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
            List<ResolveInfo> infos = pm.queryIntentActivities(launcher, 0);
            Set<String> exempt = FocusApps.exemptPackages(getContext());
            Set<String> seen = new HashSet<>();
            JSArray apps = new JSArray();
            for (ResolveInfo ri : infos) {
                String pkg = ri.activityInfo.packageName;
                if (exempt.contains(pkg) || !seen.add(pkg)) continue;
                JSObject o = new JSObject();
                o.put("package", pkg);
                o.put("label", ri.loadLabel(pm).toString());
                o.put("icon", iconBase64(ri.loadIcon(pm)));
                apps.put(o);
            }
            JSObject r = new JSObject();
            r.put("apps", apps);
            call.resolve(r);
        }).start();
    }

    private static String iconBase64(Drawable d) {
        try {
            int size = 72;
            Bitmap bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
            Canvas c = new Canvas(bmp);
            d.setBounds(0, 0, size, size);
            d.draw(c);
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            bmp.compress(Bitmap.CompressFormat.PNG, 100, out);
            return "data:image/png;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
        } catch (Exception e) {
            return null;
        }
    }

    @PluginMethod
    public void setConfig(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        Set<String> pkgs = new HashSet<>();
        JSArray packages = call.getArray("packages", new JSArray());
        JSArray windows = call.getArray("windows", new JSArray());
        try {
            for (int i = 0; i < packages.length(); i++) pkgs.add(packages.getString(i));
            new FocusStore(getContext()).save(enabled, pkgs, new JSONArray(windows.toString()));
            FocusScheduler.sync(getContext());
            call.resolve();
        } catch (JSONException e) {
            call.reject("Configuración no válida: " + e.getMessage());
        }
    }

    @PluginMethod
    public void unlock(PluginCall call) {
        Set<String> ids = new HashSet<>();
        try {
            JSArray arr = call.getArray("ids", new JSArray());
            for (int i = 0; i < arr.length(); i++) ids.add(arr.getString(i));
        } catch (JSONException ignored) {}
        new FocusStore(getContext()).unlock(ids);
        FocusScheduler.scheduleNext(getContext());
        call.resolve();
    }

    @PluginMethod
    public void getUnlocked(PluginCall call) {
        JSObject r = new JSObject();
        r.put("ids", new JSArray(new FocusStore(getContext()).unlocked()));
        call.resolve(r);
    }

    @PluginMethod
    public void allowTemporarily(PluginCall call) {
        String pkg = call.getString("package");
        int minutes = call.getInt("minutes", 5);
        if (pkg == null) {
            call.reject("Falta el paquete");
            return;
        }
        new FocusStore(getContext()).allow(pkg, System.currentTimeMillis() + minutes * 60000L);
        call.resolve();
    }

    @PluginMethod
    public void launchApp(PluginCall call) {
        String pkg = call.getString("package");
        Intent i = pkg != null ? getContext().getPackageManager().getLaunchIntentForPackage(pkg) : null;
        if (i == null) {
            call.reject("No se pudo abrir la app");
            return;
        }
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }

    @PluginMethod
    public void goHome(PluginCall call) {
        Intent home = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(home);
        call.resolve();
    }

    @PluginMethod
    public void getAttempts(PluginCall call) {
        long since = call.getLong("since", 0L);
        JSONArray all = new FocusStore(getContext()).attempts();
        JSArray out = new JSArray();
        for (int i = 0; i < all.length(); i++) {
            JSONObject o = all.optJSONObject(i);
            if (o != null && o.optLong("at") >= since) out.put(o);
        }
        JSObject r = new JSObject();
        r.put("attempts", out);
        call.resolve(r);
    }
}
