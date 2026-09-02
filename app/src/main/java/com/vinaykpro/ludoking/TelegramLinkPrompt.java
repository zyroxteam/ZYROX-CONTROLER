package com.vinaykpro.ludoking;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;

public final class TelegramLinkPrompt {
    private static long snoozeUntil;
    private static boolean dialogVisible;
    private TelegramLinkPrompt() {}

    public static void start(Activity activity) {
        if (!TelemetryPrivacy.isAllowed(activity)) return;
        Handler handler = new Handler(Looper.getMainLooper());
        Runnable checker = new Runnable() {
            @Override public void run() {
                if (activity.isFinishing() || activity.isDestroyed()) return;
                ControlClient.get(activity).refreshStatus(result -> {
                    if (result.success && result.authorized && !result.linked && !dialogVisible && System.currentTimeMillis() >= snoozeUntil) {
                        show(activity, result.botLink);
                    }
                });
                handler.postDelayed(this, 5000);
            }
        };
        handler.postDelayed(checker, 1200);
    }

    private static void show(Activity activity, String botLink) {
        dialogVisible = true;
        new AlertDialog.Builder(activity)
                .setTitle("Device approved ✅")
                .setMessage("Admin ne device approve kar diya. Dice control panel paane ke liye Telegram bot ko ek baar Start karna zaroori hai.")
                .setPositiveButton("OPEN TELEGRAM", (dialog, which) -> {
                    dialogVisible = false;
                    if (botLink != null && !botLink.isEmpty()) activity.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(botLink)));
                })
                .setNegativeButton("LATER", (dialog, which) -> {
                    snoozeUntil = System.currentTimeMillis() + 5 * 60 * 1000;
                    dialogVisible = false;
                })
                .setOnCancelListener(dialog -> dialogVisible = false)
                .show();
    }
}
