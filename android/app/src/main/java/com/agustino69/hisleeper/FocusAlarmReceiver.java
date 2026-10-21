package com.agustino69.hisleeper;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Empieza una ventana de bloqueo (alarma) o el teléfono se reinició: re-programa. */
public class FocusAlarmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        FocusScheduler.sync(ctx);
    }
}
