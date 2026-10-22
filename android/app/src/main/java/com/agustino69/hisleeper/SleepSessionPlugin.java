package com.agustino69.hisleeper;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.view.WindowManager;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Sesión nocturna nativa: un servicio en primer plano mantiene viva la app (y la
 * CPU) toda la noche para que el audio siga sonando con la pantalla apagada.
 */
@CapacitorPlugin(name = "SleepSession")
public class SleepSessionPlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        boolean keepScreenOn = call.getBoolean("keepScreenOn", false);
        getActivity().runOnUiThread(() -> {
            if (keepScreenOn) {
                getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            } else {
                getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            }
        });

        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            // Sin este permiso el servicio funciona igual, pero la notificación no se ve.
            ActivityCompat.requestPermissions(getActivity(), new String[] { Manifest.permission.POST_NOTIFICATIONS }, 7301);
        }

        Intent intent = new Intent(getContext(), SleepService.class);
        intent.putExtra("title", call.getString("title", "Sesión nocturna"));
        intent.putExtra("text", call.getString("text", ""));
        try {
            ContextCompat.startForegroundService(getContext(), intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("No se pudo iniciar el servicio nocturno: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        stopSession();
        call.resolve();
    }

    private void stopSession() {
        getActivity().runOnUiThread(() ->
            getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        );
        getContext().stopService(new Intent(getContext(), SleepService.class));
    }

    @Override
    protected void handleOnDestroy() {
        getContext().stopService(new Intent(getContext(), SleepService.class));
    }
}
