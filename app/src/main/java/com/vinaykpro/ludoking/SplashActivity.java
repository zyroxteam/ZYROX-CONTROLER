package com.vinaykpro.ludoking;

import androidx.appcompat.app.AppCompatActivity;

import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

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
                    String message = result.success ? "ENTER YOUR DEVICE KEY TO ACTIVATE" : "CONNECTING TO ACTIVATION SERVER";
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
        ControlClient client = ControlClient.get(this);
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

        TextView title = label("🔐  DEVICE ACTIVATION", 19, Color.WHITE, Typeface.BOLD);
        title.setGravity(Gravity.CENTER);
        panel.addView(title);
        TextView idTitle = label("YOUR DEVICE ID", 10, Color.rgb(180, 161, 211), Typeface.BOLD);
        idTitle.setGravity(Gravity.CENTER);
        idTitle.setPadding(0, dp(10), 0, 0);
        panel.addView(idTitle);
        TextView id = label(client.getDeviceId(), 18, Color.rgb(210, 190, 255), Typeface.BOLD);
        id.setTypeface(Typeface.MONOSPACE, Typeface.BOLD);
        id.setGravity(Gravity.CENTER);
        id.setPadding(0, dp(3), 0, dp(8));
        panel.addView(id);
        TextView note = label("GET KEY tap karein. Telegram bot OWNER @ZB_EXPLOIT ko aapka username, User ID aur Device ID bhejega. Owner ki key niche sirf ek baar enter karein.", 12, Color.rgb(190, 179, 210), Typeface.NORMAL);
        note.setGravity(Gravity.CENTER);
        panel.addView(note);

        Button getKey = actionButton("GET KEY FROM TELEGRAM  →", Color.rgb(124, 77, 255));
        LinearLayout.LayoutParams buttonParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(50));
        buttonParams.topMargin = dp(13);
        panel.addView(getKey, buttonParams);

        EditText keyInput = new EditText(this);
        keyInput.setHint("LK-DEVICEID-KEY");
        keyInput.setHintTextColor(Color.rgb(132, 118, 157));
        keyInput.setTextColor(Color.WHITE);
        keyInput.setTextSize(13);
        keyInput.setSingleLine(true);
        keyInput.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS);
        keyInput.setPadding(dp(14), 0, dp(14), 0);
        GradientDrawable inputBackground = new GradientDrawable();
        inputBackground.setColor(Color.rgb(38, 29, 61));
        inputBackground.setCornerRadius(dp(13));
        inputBackground.setStroke(dp(1), Color.rgb(92, 69, 134));
        keyInput.setBackground(inputBackground);
        LinearLayout.LayoutParams inputParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(50));
        inputParams.topMargin = dp(10);
        panel.addView(keyInput, inputParams);

        Button activate = actionButton("ACTIVATE DEVICE", Color.rgb(46, 170, 111));
        LinearLayout.LayoutParams activateParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(50));
        activateParams.topMargin = dp(9);
        panel.addView(activate, activateParams);

        statusText = label("●  REGISTERING DEVICE", 12, Color.rgb(177, 139, 255), Typeface.BOLD);
        statusText.setGravity(Gravity.CENTER);
        statusText.setPadding(0, dp(12), 0, 0);
        panel.addView(statusText);

        getKey.setOnClickListener(view -> {
            getKey.setEnabled(false);
            statusText.setText("●  OPENING TELEGRAM BOT");
            client.register(result -> {
                getKey.setEnabled(true);
                String link = result.botLink.isEmpty() ? client.getBotLink() : result.botLink;
                statusText.setText(result.success ? "●  TELEGRAM MEIN START PRESS KAREIN" : "●  BOT OPENING • REGISTRATION RETRYING");
                statusText.setTextColor(result.success ? Color.rgb(65, 221, 145) : Color.rgb(255, 190, 86));
                try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(link))); }
                catch (Exception error) {
                    Toast.makeText(this, "Telegram install/open karein: @ZyroxLudoKingbot", Toast.LENGTH_LONG).show();
                }
            });
        });
        activate.setOnClickListener(view -> {
            String key = keyInput.getText().toString().trim();
            if (key.isEmpty()) { keyInput.setError("Owner se mili key enter karein"); return; }
            activate.setEnabled(false);
            statusText.setText("●  VERIFYING DEVICE KEY");
            statusText.setTextColor(Color.rgb(177, 139, 255));
            client.activateKey(key, result -> {
                activate.setEnabled(true);
                statusText.setText("●  " + result.message);
                statusText.setTextColor(result.authorized ? Color.rgb(65, 221, 145) : Color.rgb(255, 112, 121));
                if (result.success && result.authorized && !opening) {
                    opening = true;
                    handler.postDelayed(this::openHome, 700);
                }
            });
        });

        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(
                (int) (getResources().getDisplayMetrics().widthPixels * 0.90f),
                ViewGroup.LayoutParams.WRAP_CONTENT);
        params.gravity = Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL;
        params.bottomMargin = dp(26);
        addContentView(panel, params);
        handler.post(approvalChecker);
    }

    private Button actionButton(String text, int color) {
        Button button = new Button(this);
        button.setText(text);
        button.setTextColor(Color.WHITE);
        button.setTextSize(12);
        button.setTypeface(Typeface.DEFAULT_BOLD);
        button.setAllCaps(false);
        GradientDrawable background = new GradientDrawable();
        background.setColor(color);
        background.setCornerRadius(dp(13));
        button.setBackground(background);
        return button;
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
