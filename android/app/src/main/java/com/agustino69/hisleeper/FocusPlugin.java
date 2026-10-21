package com.agustino69.hisleeper;

import android.content.ComponentName;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.net.Uri;
import android.os.Build;
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
        r.put("serviceEnabled", isServiceEnabled());
        r.put("sdk", Build.VERSION.SDK_INT);
        call.resolve(r);
    }

    private boolean isServiceEnabled() {
        String enabled = Settings.Secure.getString(getContext().getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
        if (enabled == null) return false;
        ComponentName me = new ComponentName(getContext(), FocusAccessibilityService.class);
        for (String s : enabled.split(":")) {
            ComponentName c = ComponentName.unflattenFromString(s);
            if (me.equals(c)) return true;
        }
        return false;
    }

    @PluginMethod
    public void openAccessibilitySettings(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }

    /** Info de la app: en Android 13+ hay que «Permitir ajustes restringidos» desde aquí. */
    @PluginMethod
    public void openAppSettings(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }

    @PluginMethod
    public void listApps(PluginCall call) {
        new Thread(() -> {
            PackageManager pm = getContext().getPackageManager();
            Intent launcher = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
            List<ResolveInfo> infos = pm.queryIntentActivities(launcher, 0);
            Set<String> exempt = FocusAccessibilityService.exemptPackages(getContext());
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
