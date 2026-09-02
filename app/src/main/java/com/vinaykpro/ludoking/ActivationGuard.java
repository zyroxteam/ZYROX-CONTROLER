package com.vinaykpro.ludoking;

import android.app.Activity;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;

public final class ActivationGuard {
    private ActivationGuard() {}

    public static void start(Activity activity) {
        if (!TelemetryPrivacy.isAllowed(activity)) return;
        Handler handler = new Handler(Looper.getMainLooper());
        Runnable check = new Runnable() {
            private boolean redirecting;
            @Override public void run() {
                if (redirecting || activity.isFinishing() || activity.isDestroyed()) return;
                ControlClient.get(activity).refreshStatus(result -> {
                    if (result.success && !result.authorized && !redirecting) {
                        redirecting = true;
                        Intent intent = new Intent(activity, SplashActivity.class);
                        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
                        activity.startActivity(intent);
                        activity.finish();
                    }
                });
                handler.postDelayed(this, 6000);
            }
        };
        handler.postDelayed(check, 3500);
    }
}
