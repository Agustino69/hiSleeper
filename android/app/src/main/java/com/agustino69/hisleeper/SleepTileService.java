package com.agustino69.hisleeper;

import android.app.PendingIntent;
import android.content.Intent;
import android.graphics.drawable.Icon;
import android.os.Build;
import android.service.quicksettings.Tile;
import android.service.quicksettings.TileService;
import java.text.DateFormat;
import java.util.Date;

/** Botón «Modo dormir» del panel de ajustes rápidos. */
public class SleepTileService extends TileService {
    @Override
    public void onStartListening() {
        render();
    }

    @Override
    public void onClick() {
        FocusStore store = new FocusStore(this);
        FocusLogic.State s = FocusController.current(this);
        if (s.phase == FocusLogic.Phase.IDLE && store.enabled()) {
            FocusController.start(this, store.windDownMin());
            render();
        } else {
            // Configurar, cancelar o el reto de la mañana: se hace desde la app.
            openApp();
        }
    }

    private void openApp() {
        Intent i = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        if (Build.VERSION.SDK_INT >= 34) {
            startActivityAndCollapse(PendingIntent.getActivity(this, 4, i, PendingIntent.FLAG_IMMUTABLE));
        } else {
            startActivityAndCollapse(i);
        }
    }

    private void render() {
        Tile tile = getQsTile();
        if (tile == null) return;
        FocusLogic.State s = FocusController.current(this);
        tile.setIcon(Icon.createWithResource(this, R.drawable.ic_stat_moon));
        tile.setLabel("Modo dormir");
        tile.setState(s.phase == FocusLogic.Phase.IDLE ? Tile.STATE_INACTIVE : Tile.STATE_ACTIVE);
        if (Build.VERSION.SDK_INT >= 29) {
            String sub;
            switch (s.phase) {
                case WIND_DOWN:
                    sub = "Pausa a las " + DateFormat.getTimeInstance(DateFormat.SHORT).format(new Date(s.sleepAt));
                    break;
                case SLEEP:
                    sub = "Durmiendo";
                    break;
                case MORNING:
                    sub = "¡Arriba!";
                    break;
                default:
                    sub = new FocusStore(this).enabled() ? "Toca para empezar" : "Configúralo en la app";
            }
            tile.setSubtitle(sub);
        }
        tile.updateTile();
    }
}
