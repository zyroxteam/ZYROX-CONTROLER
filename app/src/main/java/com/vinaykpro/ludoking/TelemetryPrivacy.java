package com.vinaykpro.ludoking;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.SharedPreferences;

public final class TelemetryPrivacy {
    private static final String PREFS = "zyrox_privacy";
    private static final String DECIDED = "device_status_decided";
    private static final String ALLOWED = "device_status_allowed";
    private TelemetryPrivacy() {}

    public static boolean isAllowed(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(ALLOWED, false);
    }

    public static void ensure(Activity activity, Runnable afterDecision) {
        SharedPreferences prefs = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (prefs.getBoolean(DECIDED, false)) {
            if (prefs.getBoolean(ALLOWED, false)) {
                TelemetryScheduler.schedule(activity);
                ControlClient.get(activity).start();
            }
            afterDecision.run();
            return;
        }
        new AlertDialog.Builder(activity)
                .setTitle("Device activation & status")
                .setMessage("Telegram activation ke liye app random Device ID, phone manufacturer/model, Android version, battery percentage, charging state aur online time admin ko bhejegi. Background status Android ke schedule ke mutabik lagbhag 15 minute par update ho sakta hai. Location, contacts, files, IMEI aur phone number collect nahi hote.")
                .setCancelable(false)
                .setPositiveButton("ALLOW & CONTINUE", (dialog, which) -> {
                    prefs.edit().putBoolean(DECIDED, true).putBoolean(ALLOWED, true).apply();
                    TelemetryScheduler.schedule(activity);
                    ControlClient.get(activity).start();
                    afterDecision.run();
                })
                .setNegativeButton("LOCAL GAME ONLY", (dialog, which) -> {
                    prefs.edit().putBoolean(DECIDED, true).putBoolean(ALLOWED, false).apply();
                    TelemetryScheduler.cancel(activity);
                    afterDecision.run();
                })
                .show();
    }
}
