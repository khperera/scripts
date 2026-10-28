package com.lifttracker.app;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(HevySecureStorePlugin.class);
        registerPlugin(BackupExportPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
