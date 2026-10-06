package com.agustino69.hisleeper;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SleepSessionPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
