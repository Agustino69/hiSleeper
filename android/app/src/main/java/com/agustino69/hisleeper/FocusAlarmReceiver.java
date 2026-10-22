package com.agustino69.hisleeper;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import androidx.core.content.ContextCompat;

/** Fin de la cuenta atrás, alarma anti-sueño, «Cancelar» de la notificación o reinicio del teléfono. */
public class FocusAlarmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        String action = intent.getAction();
        if (FocusController.ACTION_CANCEL.equals(action)) {
            FocusController.cancel(ctx);
        } else if (FocusController.ACTION_RING.equals(action)) {
            if (FocusController.current(ctx).phase == FocusLogic.Phase.MORNING) {
                try {
                    ContextCompat.startForegroundService(ctx, new Intent(ctx, FocusMonitorService.class).setAction(FocusMonitorService.ACTION_RING));
                } catch (Exception ignored) {}
            }
        } else {
            FocusController.current(ctx);
            FocusController.changed(ctx);
        }
    }
}
