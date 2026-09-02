package com.vinaykpro.ludoking;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.view.Gravity;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

public final class ControllerDialog {
    private static final int PURPLE=Color.rgb(124,77,255), PANEL=Color.rgb(25,19,42), CARD=Color.rgb(38,29,61), MUTED=Color.rgb(187,174,211);
    private ControllerDialog(){}

    public static void show(Activity activity){
        ControlClient client=ControlClient.get(activity); int pad=dp(activity,22);
        LinearLayout root=new LinearLayout(activity);root.setOrientation(LinearLayout.VERTICAL);root.setPadding(pad,dp(activity,24),pad,dp(activity,20));root.setBackground(rounded(PANEL,24,Color.rgb(101,75,150)));
        TextView eyebrow=text(activity,"ZYROX SYSTEMS  •  @ZB_EXPLOIT",11,MUTED,Typeface.BOLD);eyebrow.setLetterSpacing(.11f);root.addView(eyebrow);
        TextView title=text(activity,"COLOUR DICE CONTROL",25,Color.WHITE,Typeface.BOLD);title.setPadding(0,dp(activity,5),0,dp(activity,5));root.addView(title);
        TextView colors=text(activity,"🔴 RED   🟢 GREEN   🔵 BLUE   🟡 YELLOW",13,Color.rgb(225,215,245),Typeface.BOLD);colors.setPadding(0,0,0,dp(activity,16));root.addView(colors);

        LinearLayout card=new LinearLayout(activity);card.setOrientation(LinearLayout.VERTICAL);card.setPadding(dp(activity,16),dp(activity,13),dp(activity,16),dp(activity,13));card.setBackground(rounded(CARD,15,Color.rgb(82,61,120)));
        TextView idLabel=text(activity,"DEVICE ID • TAP TO COPY",10,MUTED,Typeface.BOLD);idLabel.setLetterSpacing(.12f);TextView idValue=text(activity,client.getDeviceId(),20,Color.WHITE,Typeface.BOLD);idValue.setTypeface(Typeface.MONOSPACE,Typeface.BOLD);idValue.setPadding(0,dp(activity,5),0,0);card.addView(idLabel);card.addView(idValue);card.setOnClickListener(v->copy(activity,client.getDeviceId()));root.addView(card,params(ViewGroup.LayoutParams.WRAP_CONTENT,8));

        TextView status=text(activity,"●  "+client.getLastMessage(),13,statusColor(client),Typeface.BOLD);status.setPadding(dp(activity,2),dp(activity,9),0,dp(activity,10));root.addView(status);
        TextView instruction=text(activity,"Device-bound key active hai. Telegram bot open karke colour select karein, phir 6 5 4 3 2 1 mein se next roll choose karein.",12,MUTED,Typeface.NORMAL);instruction.setPadding(0,0,0,dp(activity,12));root.addView(instruction);

        Button connect=button(activity,"OPEN DICE CONTROL BOT  →",PURPLE);root.addView(connect,params(dp(activity,52),4));
        LinearLayout actions=new LinearLayout(activity);actions.setOrientation(LinearLayout.HORIZONTAL);Button copy=button(activity,"COPY ID",CARD),refresh=button(activity,"REFRESH",CARD);actions.addView(copy,weight(dp(activity,48)));actions.addView(refresh,weight(dp(activity,48)));root.addView(actions);
        TextView secure=text(activity,"Bot token APK ke andar store nahi hai.",11,Color.rgb(147,133,170),Typeface.NORMAL);secure.setGravity(Gravity.CENTER);secure.setPadding(0,dp(activity,15),0,0);root.addView(secure);

        AlertDialog dialog=new AlertDialog.Builder(activity).setView(root).create();dialog.setOnShowListener(x->{Window w=dialog.getWindow();if(w!=null){w.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));w.setLayout((int)(activity.getResources().getDisplayMetrics().widthPixels*.93f),WindowManager.LayoutParams.WRAP_CONTENT);}});
        copy.setOnClickListener(v->copy(activity,client.getDeviceId()));
        refresh.setOnClickListener(v->{loading(status,"Checking…");client.refreshStatus(r->render(status,instruction,r));});
        connect.setOnClickListener(v->{loading(status,"Opening dice control bot…");connect.setEnabled(false);client.register(r->{connect.setEnabled(true);render(status,instruction,r);if(!r.success)return;if(r.botLink.isEmpty()){Toast.makeText(activity,"Bot link unavailable",Toast.LENGTH_LONG).show();return;}try{activity.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(r.botLink)));}catch(Exception e){copy(activity,client.getDeviceId());Toast.makeText(activity,"Telegram open nahi hua; ID copied",Toast.LENGTH_LONG).show();}});});
        dialog.show();client.refreshStatus(r->render(status,instruction,r));
    }
    private static void render(TextView status,TextView instruction,ControlClient.Result r){int color=!r.success?Color.rgb(255,112,121):r.maintenance?Color.rgb(255,185,75):r.authorized&&r.linked?Color.rgb(65,221,145):Color.rgb(255,185,75);status.setText("●  "+r.message);status.setTextColor(color);instruction.setText(r.authorized?"Device-bound key active hai. Telegram bot mein colour aur 6 5 4 3 2 1 controls use karein.":"App dobara lock ho chuki hai. Owner se new device key lein.");}
    private static void loading(TextView v,String message){v.setText("●  "+message);v.setTextColor(Color.rgb(177,139,255));}
    private static int statusColor(ControlClient c){return c.isAuthorized()&&c.isLinked()?Color.rgb(65,221,145):Color.rgb(255,185,75);}
    private static void copy(Context c,String id){((ClipboardManager)c.getSystemService(Context.CLIPBOARD_SERVICE)).setPrimaryClip(ClipData.newPlainText("ZYROX Device ID",id));Toast.makeText(c,"Device ID copied",Toast.LENGTH_SHORT).show();}
    private static TextView text(Context c,String value,int sp,int color,int style){TextView v=new TextView(c);v.setText(value);v.setTextSize(sp);v.setTextColor(color);v.setTypeface(Typeface.create("sans-serif",style));return v;}
    private static Button button(Context c,String value,int color){Button b=new Button(c);b.setText(value);b.setTextColor(Color.WHITE);b.setTextSize(12);b.setTypeface(Typeface.DEFAULT_BOLD);b.setAllCaps(false);b.setGravity(Gravity.CENTER);b.setBackground(rounded(color,13,color==CARD?Color.rgb(82,61,120):Color.rgb(82,50,170)));return b;}
    private static GradientDrawable rounded(int color,int radius,int stroke){GradientDrawable d=new GradientDrawable();d.setColor(color);d.setCornerRadius(dpValue(radius));d.setStroke(1,stroke);return d;}
    private static float dpValue(int v){return v*2.8f;}
    private static LinearLayout.LayoutParams params(int height,int top){LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,height);p.topMargin=dpStatic(top);return p;}
    private static LinearLayout.LayoutParams weight(int height){LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(0,height,1);p.leftMargin=dpStatic(5);p.rightMargin=dpStatic(5);return p;}
    private static int dpStatic(int v){return (int)(v*2.8f);}
    private static int dp(Context c,int v){return Math.round(v*c.getResources().getDisplayMetrics().density);}
}
