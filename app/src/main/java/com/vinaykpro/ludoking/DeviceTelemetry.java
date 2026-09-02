package com.vinaykpro.ludoking;

import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.BatteryManager;
import android.os.Build;

import org.json.JSONObject;

public final class DeviceTelemetry {
    private DeviceTelemetry() {}

    public static JSONObject collect(Context context) {
        JSONObject data = new JSONObject();
        try {
            Intent battery = context.registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
            int level = battery == null ? -1 : battery.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
            int scale = battery == null ? -1 : battery.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
            int percent = level >= 0 && scale > 0 ? Math.round(level * 100f / scale) : -1;
            int status = battery == null ? -1 : battery.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
            boolean charging = status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL;
            data.put("manufacturer", clean(Build.MANUFACTURER));
            data.put("model", clean(Build.MODEL));
            data.put("androidVersion", clean(Build.VERSION.RELEASE));
            data.put("sdkInt", Build.VERSION.SDK_INT);
            data.put("batteryLevel", percent);
            data.put("charging", charging);
            data.put("online", isOnline(context));
            data.put("consentVersion", "1");
        } catch (Exception ignored) {}
        return data;
    }

    private static boolean isOnline(Context context) {
        try {
            ConnectivityManager manager = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
            if (manager == null) return false;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                Network network = manager.getActiveNetwork();
                NetworkCapabilities capabilities = manager.getNetworkCapabilities(network);
                return capabilities != null && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
            }
            return manager.getActiveNetworkInfo() != null && manager.getActiveNetworkInfo().isConnected();
        } catch (Exception ignored) { return false; }
    }

    private static String clean(String value) {
        if (value == null) return "";
        value = value.trim();
        return value.length() > 80 ? value.substring(0, 80) : value;
    }
}
