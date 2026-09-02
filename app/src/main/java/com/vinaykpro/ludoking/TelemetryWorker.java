package com.vinaykpro.ludoking;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

public final class TelemetryWorker extends Worker {
    public TelemetryWorker(@NonNull Context context, @NonNull WorkerParameters parameters) {
        super(context, parameters);
    }

    @NonNull
    @Override
    public Result doWork() {
        if (!TelemetryPrivacy.isAllowed(getApplicationContext())) return Result.success();
        return ControlClient.get(getApplicationContext()).sendTelemetryBlocking() ? Result.success() : Result.retry();
    }
}
