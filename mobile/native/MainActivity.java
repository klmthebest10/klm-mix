package com.klm.mix.hp;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MirrorPlugin.class);
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        handleLink(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleLink(intent);
    }

    // tautan klmmix://mirror?h=...&p=...&t=... (dari QR Mirroring di KLM Mix PC)
    private void handleLink(Intent intent) {
        if (intent == null) return;
        Uri d = intent.getData();
        if (d != null && "klmmix".equals(d.getScheme())) MirrorPlugin.link(d.toString());
    }
}
