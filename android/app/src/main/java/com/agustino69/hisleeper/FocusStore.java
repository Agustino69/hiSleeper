package com.agustino69.hisleeper;

import android.content.Context;
import android.content.SharedPreferences;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Configuración del bloqueo y registro de intentos, compartidos por el plugin y el servicio. */
public class FocusStore {
    private static final String PREFS = "hisleeper_focus";
    private static final int MAX_ATTEMPTS = 500;
    private final SharedPreferences prefs;

    public FocusStore(Context ctx) {
        prefs = ctx.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public boolean enabled() {
        return prefs.getBoolean("enabled", false);
    }

    public Set<String> packages() {
        return new HashSet<>(prefs.getStringSet("packages", new HashSet<>()));
    }

    public Set<String> unlocked() {
        return new HashSet<>(prefs.getStringSet("unlocked", new HashSet<>()));
    }

    public void save(boolean enabled, Set<String> packages, JSONArray windows) {
        prefs.edit().putBoolean("enabled", enabled).putStringSet("packages", packages).putString("windows", windows.toString()).apply();
    }

    public List<FocusLogic.Window> windows() {
        List<FocusLogic.Window> out = new ArrayList<>();
        try {
            JSONArray arr = new JSONArray(prefs.getString("windows", "[]"));
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.getJSONObject(i);
                out.add(new FocusLogic.Window(o.getString("id"), o.getString("kind"), o.getLong("start"), o.getLong("end")));
            }
        } catch (JSONException ignored) {
            // Configuración corrupta: sin ventanas, sin bloqueo.
        }
        return out;
    }

    public void unlock(Set<String> ids) {
        Set<String> u = unlocked();
        u.addAll(ids);
        // Solo se conservan los desbloqueos de ventanas que aún existen.
        Set<String> live = new HashSet<>();
        for (FocusLogic.Window w : windows()) live.add(w.id);
        u.retainAll(live);
        u.addAll(ids);
        prefs.edit().putStringSet("unlocked", u).apply();
    }

    public long allowedUntil(String pkg) {
        try {
            return new JSONObject(prefs.getString("allow", "{}")).optLong(pkg, 0);
        } catch (JSONException e) {
            return 0;
        }
    }

    public void allow(String pkg, long until) {
        try {
            JSONObject o = new JSONObject(prefs.getString("allow", "{}"));
            o.put(pkg, until);
            prefs.edit().putString("allow", o.toString()).apply();
        } catch (JSONException ignored) {}
    }

    public void logAttempt(String pkg, String label, String kind, long at) {
        try {
            JSONArray arr = new JSONArray(prefs.getString("attempts", "[]"));
            JSONObject o = new JSONObject();
            o.put("package", pkg);
            o.put("label", label);
            o.put("kind", kind);
            o.put("at", at);
            arr.put(o);
            JSONArray trimmed = new JSONArray();
            for (int i = Math.max(0, arr.length() - MAX_ATTEMPTS); i < arr.length(); i++) trimmed.put(arr.get(i));
            prefs.edit().putString("attempts", trimmed.toString()).apply();
        } catch (JSONException ignored) {}
    }

    public JSONArray attempts() {
        try {
            return new JSONArray(prefs.getString("attempts", "[]"));
        } catch (JSONException e) {
            return new JSONArray();
        }
    }
}
