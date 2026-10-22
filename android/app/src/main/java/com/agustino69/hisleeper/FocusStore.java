package com.agustino69.hisleeper;

import android.content.Context;
import android.content.SharedPreferences;
import java.util.HashSet;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Estado del modo dormir, configuración y registro de intentos (compartido por plugin, servicio y botón). */
public class FocusStore {
    private static final String PREFS = "hisleeper_focus";
    private static final int MAX_ATTEMPTS = 500;
    private final SharedPreferences prefs;

    public FocusStore(Context ctx) {
        prefs = ctx.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    // ── Configuración ──

    public boolean enabled() {
        return prefs.getBoolean("enabled", false);
    }

    public Set<String> packages() {
        return new HashSet<>(prefs.getStringSet("packages", new HashSet<>()));
    }

    public int windDownMin() {
        return prefs.getInt("windDownMin", 30);
    }

    public int steps() {
        return prefs.getInt("steps", 40);
    }

    public String challenge() {
        return prefs.getString("challenge", "steps");
    }

    public FocusLogic.Config config() {
        return new FocusLogic.Config(
            prefs.getInt("minSleepMin", 300) * 60000L,
            prefs.getInt("snoozeMin", 5) * 60000L,
            prefs.getBoolean("antiSnooze", true)
        );
    }

    public void saveConfig(
        boolean enabled,
        Set<String> packages,
        int windDownMin,
        int minSleepMin,
        int snoozeMin,
        boolean antiSnooze,
        int steps,
        String challenge
    ) {
        prefs
            .edit()
            .putBoolean("enabled", enabled)
            .putStringSet("packages", packages)
            .putInt("windDownMin", windDownMin)
            .putInt("minSleepMin", minSleepMin)
            .putInt("snoozeMin", snoozeMin)
            .putBoolean("antiSnooze", antiSnooze)
            .putInt("steps", steps)
            .putString("challenge", challenge)
            .apply();
    }

    // ── Estado ──

    public FocusLogic.State state() {
        FocusLogic.Phase phase;
        try {
            phase = FocusLogic.Phase.valueOf(prefs.getString("phase", "IDLE"));
        } catch (IllegalArgumentException e) {
            phase = FocusLogic.Phase.IDLE;
        }
        return new FocusLogic.State(
            phase,
            prefs.getLong("startedAt", 0),
            prefs.getLong("sleepAt", 0),
            prefs.getLong("morningAt", 0),
            prefs.getBoolean("usedBackToSleep", false)
        );
    }

    /** Guarda el estado; devuelve true si cambió de fase. */
    public boolean setState(FocusLogic.State s) {
        boolean changed = state().phase != s.phase;
        prefs
            .edit()
            .putString("phase", s.phase.name())
            .putLong("startedAt", s.startedAt)
            .putLong("sleepAt", s.sleepAt)
            .putLong("morningAt", s.morningAt)
            .putBoolean("usedBackToSleep", s.usedBackToSleep)
            .apply();
        return changed;
    }

    public long screenOffAt() {
        return prefs.getLong("screenOffAt", 0);
    }

    public void setScreenOffAt(long t) {
        prefs.edit().putLong("screenOffAt", t).apply();
    }

    // ── Permisos temporales (solo de noche) ──

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

    // ── Registro ──

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
