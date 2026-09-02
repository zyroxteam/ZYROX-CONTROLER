package com.vinaykpro.ludoking;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import org.json.JSONObject;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Locale;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

public final class ControlClient {
    public interface Callback { void onResult(Result result); }
    public static final class Result {
        public final boolean success, authorized, linked, maintenance;
        public final String botLink, activationOwner, message;
        Result(boolean success, boolean authorized, boolean linked, boolean maintenance, String botLink, String activationOwner, String message) {
            this.success=success; this.authorized=authorized; this.linked=linked; this.maintenance=maintenance;
            this.botLink=botLink==null?"":botLink; this.activationOwner=activationOwner==null?"@ZB_EXPLOIT":activationOwner; this.message=message==null?"":message;
        }
    }

    private static final String PREFS="zyrox_controler", PREF_DEVICE_ID="device_id", PREF_DEVICE_SECRET="device_secret", PREF_SERVER_URL="server_url";
    private static final String DEFAULT_SERVER="https://zyrox-shield.antideploy.com";
    private static volatile ControlClient instance;
    private final SharedPreferences preferences;
    private final Handler mainHandler=new Handler(Looper.getMainLooper());
    private final ScheduledExecutorService executor=Executors.newScheduledThreadPool(2);
    private final ConcurrentHashMap<String, AtomicInteger> pending=new ConcurrentHashMap<>();
    private final String deviceId, deviceSecret;
    private volatile boolean registered, authorized, linked, maintenance;
    private volatile String lastMessage="Connecting", botLink="", activationOwner="@ZB_EXPLOIT";
    private ScheduledFuture<?> pollingTask;

    private ControlClient(Context context) {
        preferences=context.getApplicationContext().getSharedPreferences(PREFS,Context.MODE_PRIVATE);
        deviceId=getOrCreateDeviceId(); deviceSecret=getOrCreateSecret();
        for(String c:new String[]{"red","green","blue","yellow"}) pending.put(c,new AtomicInteger(0));
    }
    public static ControlClient get(Context context) {
        if(instance==null) synchronized(ControlClient.class){ if(instance==null) instance=new ControlClient(context); }
        return instance;
    }
    public String getDeviceId(){return deviceId;}
    public String getServerUrl(){return preferences.getString(PREF_SERVER_URL,DEFAULT_SERVER);}
    public boolean isAuthorized(){return authorized;}
    public boolean isLinked(){return linked;}
    public boolean isMaintenance(){return maintenance;}
    public String getLastMessage(){return lastMessage;}
    public String getActivationOwner(){return activationOwner;}
    public int takePendingDice(String colour){ AtomicInteger value=pending.get(normalizeColour(colour)); return value==null?0:value.getAndSet(0); }

    public void setServerUrl(String input){
        String value=normalizeServerUrl(input); if(value.isEmpty()) value=DEFAULT_SERVER;
        preferences.edit().putString(PREF_SERVER_URL,value).apply(); registered=false; authorized=false; linked=false; clearPending(); lastMessage="Connecting"; start();
    }
    public synchronized void start(){ if(pollingTask==null||pollingTask.isCancelled()) pollingTask=executor.scheduleWithFixedDelay(this::pollSafely,0,1100,TimeUnit.MILLISECONDS); }
    public synchronized void stop(){ if(pollingTask!=null){pollingTask.cancel(false); pollingTask=null;} }
    public void register(Callback callback){ executor.execute(()->post(callback,registerBlocking())); }
    public void refreshStatus(Callback callback){ executor.execute(()->post(callback,registered?statusBlocking():registerBlocking())); }

    private void pollSafely(){
        try{
            if(!registered){registerBlocking(); return;}
            JSONObject response=request("GET","/api/v1/devices/"+deviceId+"/next-command",null,true);
            updateState(response);
            JSONObject command=response.optJSONObject("command");
            if(command!=null){
                String colour=normalizeColour(command.optString("colour","")); int dice=command.optInt("dice",0);
                if(pending.containsKey(colour)&&dice>=1&&dice<=6) pending.get(colour).set(dice);
            }
            lastMessage=connectionMessage();
        }catch(Exception error){lastMessage=readableError(error); if(lastMessage.contains("403")||lastMessage.contains("404"))registered=false;}
    }
    private Result registerBlocking(){
        try{
            JSONObject body=new JSONObject(); body.put("deviceId",deviceId); body.put("deviceSecret",deviceSecret); body.put("appVersion",BuildConfig.VERSION_NAME);
            JSONObject response=request("POST","/api/v1/devices/register",body,false); registered=response.optBoolean("ok",false); updateState(response); lastMessage=connectionMessage(); return snapshot(true);
        }catch(Exception error){registered=false; lastMessage=readableError(error); return snapshot(false);}
    }
    private Result statusBlocking(){
        try{JSONObject response=request("GET","/api/v1/devices/"+deviceId+"/status",null,true); updateState(response); lastMessage=connectionMessage(); return snapshot(true);}
        catch(Exception error){lastMessage=readableError(error); return snapshot(false);}
    }
    private Result snapshot(boolean success){return new Result(success,authorized,linked,maintenance,botLink,activationOwner,lastMessage);}
    private String connectionMessage(){
        if(maintenance)return "Maintenance"; if(authorized&&linked)return "Activated • Telegram connected";
        if(authorized)return "Activated • Connect Telegram"; return "ID sent to "+activationOwner+" • waiting activation";
    }
    private void updateState(JSONObject response){
        authorized=response.optBoolean("authorized",false); linked=response.optBoolean("linked",linked); maintenance=response.optBoolean("maintenance",false);
        String link=response.optString("botLink",""); if(!link.isEmpty())botLink=link;
        String owner=response.optString("activationOwner",""); if(!owner.isEmpty())activationOwner=owner;
    }
    private JSONObject request(String method,String path,JSONObject body,boolean authenticate)throws Exception{
        HttpURLConnection connection=(HttpURLConnection)new URL(getServerUrl()+path).openConnection();
        connection.setRequestMethod(method); connection.setConnectTimeout(5000); connection.setReadTimeout(5000); connection.setUseCaches(false);
        connection.setRequestProperty("Accept","application/json"); connection.setRequestProperty("User-Agent","ZYROX-Android/"+BuildConfig.VERSION_NAME);
        if(authenticate)connection.setRequestProperty("X-Device-Secret",deviceSecret);
        if(body!=null){connection.setDoOutput(true);connection.setRequestProperty("Content-Type","application/json; charset=utf-8");try(OutputStream out=connection.getOutputStream()){out.write(body.toString().getBytes(StandardCharsets.UTF_8));}}
        int code=connection.getResponseCode(); InputStream stream=code>=200&&code<300?connection.getInputStream():connection.getErrorStream(); String text=readAll(stream); connection.disconnect();
        if(code<200||code>=300)throw new Exception("Server error "+code+(text.isEmpty()?"":": "+text)); return new JSONObject(text);
    }
    private static String readAll(InputStream stream)throws Exception{if(stream==null)return"";StringBuilder r=new StringBuilder();try(BufferedReader reader=new BufferedReader(new InputStreamReader(stream,StandardCharsets.UTF_8))){String line;while((line=reader.readLine())!=null)r.append(line);}return r.toString();}
    private void post(Callback callback,Result result){if(callback!=null)mainHandler.post(()->callback.onResult(result));}
    private void clearPending(){for(AtomicInteger value:pending.values())value.set(0);}
    private String getOrCreateDeviceId(){
        String saved=preferences.getString(PREF_DEVICE_ID,"");if(saved.matches("^ZRX-[A-Z0-9]{12}$"))return saved;
        char[] alphabet="ABCDEFGHJKLMNPQRSTUVWXYZ23456789".toCharArray();SecureRandom random=new SecureRandom();StringBuilder id=new StringBuilder("ZRX-");for(int i=0;i<12;i++)id.append(alphabet[random.nextInt(alphabet.length)]);
        preferences.edit().putString(PREF_DEVICE_ID,id.toString()).apply();return id.toString();
    }
    private String getOrCreateSecret(){String saved=preferences.getString(PREF_DEVICE_SECRET,"");if(saved.length()>=32)return saved;byte[] bytes=new byte[32];new SecureRandom().nextBytes(bytes);String value=Base64.encodeToString(bytes,Base64.URL_SAFE|Base64.NO_PADDING|Base64.NO_WRAP);preferences.edit().putString(PREF_DEVICE_SECRET,value).apply();return value;}
    private static String normalizeColour(String value){String c=value==null?"":value.toLowerCase(Locale.US);return c.equals("red")||c.equals("green")||c.equals("blue")||c.equals("yellow")?c:"";}
    private static String normalizeServerUrl(String input){String value=input==null?"":input.trim();while(value.endsWith("/"))value=value.substring(0,value.length()-1);if(!value.isEmpty()&&!value.toLowerCase(Locale.US).startsWith("http://")&&!value.toLowerCase(Locale.US).startsWith("https://"))value="https://"+value;return value;}
    private static String readableError(Exception error){String message=error.getMessage();if(message==null||message.trim().isEmpty())return"Connection failed";return message.length()>110?message.substring(0,110)+"…":message;}
}
