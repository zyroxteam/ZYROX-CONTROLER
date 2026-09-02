package com.vinaykpro.ludoking;

import androidx.appcompat.app.AppCompatActivity;

import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.util.Objects;

public class SplashActivity extends AppCompatActivity {
    private final Handler handler = new Handler(Looper.getMainLooper());
    private TextView statusText;
    private boolean opening;

    private final Runnable approvalChecker = new Runnable() {
        @Override public void run() {
            if (isFinishing() || isDestroyed() || opening) return;
            ControlClient.get(SplashActivity.this).refreshStatus(result -> {
                if (opening || isFinishing()) return;
                if (result.success && result.authorized) {
                    opening = true;
                    statusText.setText("●  APPROVED — OPENING APP");
                    statusText.setTextColor(Color.rgb(65, 221, 145));
                    handler.postDelayed(SplashActivity.this::openHome, 700);
                } else {
                    String message = result.success ? "WAITING FOR ADMIN APPROVAL" : "CONNECTING TO ACTIVATION SERVER";
                    statusText.setText("●  " + message);
                    statusText.setTextColor(result.success ? Color.rgb(255, 190, 86) : Color.rgb(177, 139, 255));
                    handler.postDelayed(approvalChecker, 3000);
                }
            });
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setFullScreen();
        setContentView(R.layout.activity_splash);
        Objects.requireNonNull(getSupportActionBar()).hide();
        TelemetryPrivacy.ensure(this, this::showApprovalGate);
    }

    private void showApprovalGate() {
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setGravity(Gravity.CENTER);
        int padding = dp(20);
        panel.setPadding(padding, dp(18), padding, dp(18));
        GradientDrawable background = new GradientDrawable();
        background.setColor(Color.rgb(25, 19, 42));
        background.setCornerRadius(dp(22));
        background.setStroke(dp(1), Color.rgb(119, 82, 181));
        panel.setBackground(background);

        TextView title = label("ADMIN APPROVAL REQUIRED", 18, Color.WHITE, Typeface.BOLD);
        title.setGravity(Gravity.CENTER);
        panel.addView(title);
        TextView id = label(ControlClient.get(this).getDeviceId(), 19, Color.rgb(210, 190, 255), Typeface.BOLD);
        id.setTypeface(Typeface.MONOSPACE, Typeface.BOLD);
        id.setGravity(Gravity.CENTER);
        id.setPadding(0, dp(9), 0, dp(7));
        panel.addView(id);
        TextView note = label("Activation request bot par automatically send ho gayi hai. Admin approval ke bina app open nahi hogi.", 12, Color.rgb(190, 179, 210), Typeface.NORMAL);
        note.setGravity(Gravity.CENTER);
        panel.addView(note);
        statusText = label("●  SENDING ACTIVATION REQUEST", 12, Color.rgb(177, 139, 255), Typeface.BOLD);
        statusText.setGravity(Gravity.CENTER);
        statusText.setPadding(0, dp(12), 0, 0);
        panel.addView(statusText);

        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(
                (int) (getResources().getDisplayMetrics().widthPixels * 0.88f),
                ViewGroup.LayoutParams.WRAP_CONTENT);
        params.gravity = Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL;
        params.bottomMargin = dp(42);
        addContentView(panel, params);
        handler.post(approvalChecker);
    }

    private TextView label(String text, int size, int color, int style) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextSize(size);
        view.setTextColor(color);
        view.setTypeface(Typeface.create("sans-serif", style));
        return view;
    }

    private void openHome() {
        startActivity(new Intent(this, HomeActivity.class));
        finish();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    @Override protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        super.onDestroy();
    }

    void setFullScreen() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            requestWindowFeature(Window.FEATURE_NO_TITLE);
            getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN, WindowManager.LayoutParams.FLAG_FULLSCREEN);
            View dview = getWindow().getDecorView();
            dview.setSystemUiVisibility(View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        } else {
            View dview = getWindow().getDecorView();
            dview.setSystemUiVisibility(View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                WindowInsetsController controller = getWindow().getInsetsController();
                if (controller != null) {
                    controller.hide(WindowInsets.Type.navigationBars());
                    controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                }
            }
        }
    }
}
