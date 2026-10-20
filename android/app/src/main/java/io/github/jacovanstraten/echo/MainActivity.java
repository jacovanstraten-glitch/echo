package io.github.jacovanstraten.echo;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.speech.RecognizerIntent;
import android.util.Base64;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.lang.ref.WeakReference;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * Echo for Android: a full-screen window around the Echo web app, plus what a web page cannot do on a phone:
 * recording with the screen locked, Android's own dictation, and receiving audio shared from other apps
 * (WhatsApp voice notes, call recordings). The app itself, and every update, comes from GitHub Pages.
 */
public class MainActivity extends Activity {

    private static final String APP_URL = "https://jacovanstraten-glitch.github.io/echo/";
    private static final String APP_HOST = "jacovanstraten-glitch.github.io";
    private static final String APP_PATH = "/echo";
    private static final int REQ_FILES = 41, REQ_DICTATE = 42, REQ_PERMS = 43;

    private static WeakReference<MainActivity> current = new WeakReference<>(null);

    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private volatile String currentUrl = "";
    private boolean pageReady = false;
    private String pendingCommand = null;

    /** Sends an event to the web app (window.echoNative). Safe to call from any thread. */
    static void emit(String json) {
        MainActivity a = current.get();
        if (a == null) return;
        a.runOnUiThread(() -> {
            if (a.web != null) a.web.evaluateJavascript("window.echoNative&&window.echoNative(" + JSONObject.quote(json) + ")", null);
        });
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        current = new WeakReference<>(this);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#5B3FA0"));
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#F4F2F8"));
        root.addView(web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);

        root.setOnApplyWindowInsetsListener((View v, WindowInsets insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets b = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime());
                v.setPadding(b.left, b.top, b.right, b.bottom);
                return WindowInsets.CONSUMED;
            }
            v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                    insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets.consumeSystemWindowInsets();
        });

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setSupportMultipleWindows(false);
        s.setMediaPlaybackRequiresUserGesture(true);

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(web, true);

        web.addJavascriptInterface(new Bridge(), "EchoAndroid");
        cleanShared();

        web.setWebViewClient(new WebViewClient() {
            @Override
            public void doUpdateVisitedHistory(WebView view, String url, boolean isReload) {
                currentUrl = url == null ? "" : url;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                pageReady = trustedUrl(url);
                if (pageReady && pendingCommand != null) {
                    String c = pendingCommand;
                    pendingCommand = null;
                    view.postDelayed(() -> emit("{\"type\":\"command\",\"cmd\":\"" + c + "\"}"), 1500);
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if (staysInApp(u)) return false;
                openOutside(u);
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                return chooseFiles(callback);
            }
        });

        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl(APP_URL);
        handleIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    /** Shortcuts (Record, New idea) and audio shared from other apps. */
    private void handleIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (Intent.ACTION_SEND.equals(action) || Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            List<Uri> uris = new ArrayList<>();
            if (Intent.ACTION_SEND.equals(action)) {
                Uri u = intent.getParcelableExtra(Intent.EXTRA_STREAM);
                if (u != null) uris.add(u);
            } else {
                ArrayList<Uri> list = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
                if (list != null) uris.addAll(list);
            }
            if (!uris.isEmpty()) importShared(uris);
            else Toast.makeText(this, "Only audio files can be shared with Echo.", Toast.LENGTH_SHORT).show();
            setIntent(new Intent());
            return;
        }
        String cmd = null;
        if ("io.github.jacovanstraten.echo.RECORD".equals(action)) cmd = "record";
        if ("io.github.jacovanstraten.echo.IDEA".equals(action)) cmd = "idea";
        if ("io.github.jacovanstraten.echo.DICTATE".equals(action)) cmd = "dictate";
        if ("io.github.jacovanstraten.echo.ACTION".equals(action)) cmd = "action";
        if (RecorderService.ACTION_SHOW.equals(action)) cmd = "show";
        if (cmd == null) return;
        setIntent(new Intent());
        if (pageReady) emit("{\"type\":\"command\",\"cmd\":\"" + cmd + "\"}");
        else pendingCommand = cmd;
    }

    private void importShared(List<Uri> uris) {
        Toast.makeText(this, "Adding to Echo…", Toast.LENGTH_SHORT).show();
        new Thread(() -> {
            int ok = 0;
            for (Uri u : uris) {
                try {
                    String name = "Shared audio", mime = getContentResolver().getType(u);
                    try (Cursor c = getContentResolver().query(u, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
                        if (c != null && c.moveToFirst() && c.getString(0) != null) name = c.getString(0);
                    }
                    if (mime == null) mime = "audio/mp4";
                    if (!mime.startsWith("audio/") && !mime.startsWith("video/") && !mime.equals("application/ogg")) continue;
                    String ext = extFor(name, mime);
                    String fileId = Long.toString(System.currentTimeMillis(), 36) + Integer.toString((int) (Math.random() * 1e6), 36);
                    File out = new File(RecorderService.dir(this), fileId + ext);
                    try (InputStream in = getContentResolver().openInputStream(u); FileOutputStream fo = new FileOutputStream(out)) {
                        if (in == null) continue;
                        byte[] buf = new byte[64 * 1024];
                        int n;
                        while ((n = in.read(buf)) > 0) fo.write(buf, 0, n);
                    }
                    String title = name.replaceAll("\\.[A-Za-z0-9]{1,5}$", "");
                    RecorderService.writeMeta(this, fileId, System.currentTimeMillis(), RecorderService.durationOf(out), out.length(),
                            true, title, ext, mime.equals("application/ogg") ? "audio/ogg" : mime, false);
                    ok++;
                } catch (Exception ignored) { }
            }
            final int added = ok;
            runOnUiThread(() -> {
                if (added == 0) Toast.makeText(this, "This file could not be added.", Toast.LENGTH_SHORT).show();
                emit("{\"type\":\"imported\"}");
            });
        }).start();
    }

    private static String extFor(String name, String mime) {
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("(\\.[A-Za-z0-9]{2,4})$").matcher(name);
        if (m.find()) return m.group(1).toLowerCase();
        switch (mime) {
            case "audio/ogg": case "application/ogg": return ".ogg";
            case "audio/opus": return ".opus";
            case "audio/mpeg": return ".mp3";
            case "audio/wav": case "audio/x-wav": return ".wav";
            case "audio/amr": return ".amr";
            case "audio/aac": return ".aac";
            case "audio/webm": return ".webm";
            default: return ".m4a";
        }
    }

    private static boolean staysInApp(Uri u) {
        String scheme = u.getScheme();
        String host = u.getHost() == null ? "" : u.getHost().toLowerCase();
        if (!"https".equals(scheme)) return false;
        if (host.equals(APP_HOST)) return u.getPath() != null && u.getPath().startsWith(APP_PATH);
        if (host.startsWith("onedrive.") || host.contains("1drv")) return false;
        return host.endsWith("login.microsoftonline.com") || host.endsWith("login.live.com")
                || host.endsWith("account.live.com") || host.endsWith("signup.live.com")
                || host.endsWith("login.microsoft.com") || host.endsWith("account.microsoft.com")
                || host.endsWith("msauth.net") || host.endsWith("msftauth.net");
    }

    private void openOutside(Uri u) {
        try { startActivity(new Intent(Intent.ACTION_VIEW, u)); }
        catch (ActivityNotFoundException e) { Toast.makeText(this, "No app found to open this link.", Toast.LENGTH_SHORT).show(); }
    }

    private static boolean trustedUrl(String url) {
        Uri u = Uri.parse(url == null ? "" : url);
        return "https".equals(u.getScheme()) && APP_HOST.equals(u.getHost()) && u.getPath() != null && u.getPath().startsWith(APP_PATH);
    }

    /** Only the Echo pages may use the recorder, files and sharing. */
    private boolean trustedPage() { return trustedUrl(currentUrl); }

    private static String cleanName(String name) {
        String n = name == null ? "Echo" : name.replaceAll("[\\\\/:*?\"<>|]", " ").trim();
        return n.isEmpty() ? "Echo" : n;
    }

    private void cleanShared() {
        File[] old = new File(getCacheDir(), "shared").listFiles();
        if (old != null) for (File f : old) //noinspection ResultOfMethodCallIgnored
            f.delete();
    }

    private boolean hasMic() {
        return checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        if (requestCode == REQ_PERMS) emit("{\"type\":\"permission\",\"granted\":" + hasMic() + "}");
    }

    private class Bridge {
        @JavascriptInterface
        public int versionCode() {
            try { return (int) getPackageManager().getPackageInfo(getPackageName(), 0).getLongVersionCode(); }
            catch (Exception e) { return 0; }
        }

        @JavascriptInterface
        public String startRecording(String id) {
            if (!trustedPage()) return "not allowed";
            if (!hasMic()) {
                List<String> ask = new ArrayList<>();
                ask.add(Manifest.permission.RECORD_AUDIO);
                if (Build.VERSION.SDK_INT >= 33) ask.add(Manifest.permission.POST_NOTIFICATIONS);
                runOnUiThread(() -> requestPermissions(ask.toArray(new String[0]), REQ_PERMS));
                return "need-permission";
            }
            return RecorderService.start(MainActivity.this, id);
        }

        @JavascriptInterface
        public boolean pauseRecording() { return trustedPage() && RecorderService.pause(MainActivity.this); }

        @JavascriptInterface
        public boolean resumeRecording() { return trustedPage() && RecorderService.resume(MainActivity.this); }

        @JavascriptInterface
        public String stopRecording() {
            if (!trustedPage()) return "{}";
            JSONObject o = RecorderService.stop(MainActivity.this);
            return o == null ? "{}" : o.toString();
        }

        @JavascriptInterface
        public String status() { return RecorderService.status().toString(); }

        @JavascriptInterface
        public String list() { return trustedPage() ? RecorderService.list(MainActivity.this).toString() : "[]"; }

        /** Part of a recording as base64, so the web app can upload it to OneDrive. */
        @JavascriptInterface
        public String readChunk(String id, double offset, int length) {
            if (!trustedPage()) return "";
            JSONObject o = RecorderService.metaJson(MainActivity.this, id == null ? "" : id.replaceAll("[^A-Za-z0-9_-]", ""));
            if (o == null) return "";
            File f = new File(RecorderService.dir(MainActivity.this), o.optString("file"));
            try (RandomAccessFile r = new RandomAccessFile(f, "r")) {
                long off = (long) offset;
                if (off >= r.length()) return "";
                int n = (int) Math.min(length, r.length() - off);
                byte[] b = new byte[n];
                r.seek(off);
                r.readFully(b);
                return Base64.encodeToString(b, Base64.NO_WRAP);
            } catch (Exception e) {
                return "";
            }
        }

        @JavascriptInterface
        public void remove(String id) {
            if (trustedPage()) RecorderService.remove(MainActivity.this, id == null ? "" : id.replaceAll("[^A-Za-z0-9_-]", ""));
        }

        @JavascriptInterface
        public void dictate(String lang) {
            if (!trustedPage()) return;
            Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang == null || lang.isEmpty() ? "nl-NL" : lang);
            i.putExtra(RecognizerIntent.EXTRA_PROMPT, "Speak your idea");
            runOnUiThread(() -> {
                try { startActivityForResult(i, REQ_DICTATE); }
                catch (ActivityNotFoundException e) { emit("{\"type\":\"dictation\",\"error\":\"Speech recognition is not available on this phone.\"}"); }
            });
        }

        @JavascriptInterface
        public void copyText(String text) {
            if (!trustedPage()) return;
            runOnUiThread(() -> {
                ClipboardManager cm = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                cm.setPrimaryClip(ClipData.newPlainText("Echo", text));
            });
        }

        @JavascriptInterface
        public void shareText(String text, String title) {
            if (!trustedPage()) return;
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType("text/plain");
            send.putExtra(Intent.EXTRA_TEXT, text);
            send.putExtra(Intent.EXTRA_SUBJECT, title);
            Intent chooser = Intent.createChooser(send, "Share with");
            runOnUiThread(() -> startActivity(chooser));
        }

        @JavascriptInterface
        public void saveText(String text, String name) {
            if (!trustedPage()) return;
            try {
                if (Build.VERSION.SDK_INT < 29) throw new IllegalStateException("old android");
                ContentValues v = new ContentValues();
                v.put(MediaStore.Downloads.DISPLAY_NAME, cleanName(name));
                v.put(MediaStore.Downloads.MIME_TYPE, "text/plain");
                Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                if (uri == null) throw new IllegalStateException("no uri");
                try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                    if (out == null) throw new IllegalStateException("no stream");
                    out.write(text.getBytes(StandardCharsets.UTF_8));
                }
                runOnUiThread(() -> Toast.makeText(MainActivity.this, "Saved to Downloads", Toast.LENGTH_SHORT).show());
            } catch (Exception e) {
                runOnUiThread(() -> Toast.makeText(MainActivity.this, "Could not save the file.", Toast.LENGTH_SHORT).show());
            }
        }

        @JavascriptInterface
        public void vibrate() {
            try {
                Vibrator vb = (Vibrator) getSystemService(VIBRATOR_SERVICE);
                if (vb != null) vb.vibrate(VibrationEffect.createOneShot(40, VibrationEffect.DEFAULT_AMPLITUDE));
            } catch (Exception ignored) { }
        }
    }

    /** The system file picker, for importing audio files. */
    private boolean chooseFiles(ValueCallback<Uri[]> callback) {
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        fileCallback = callback;
        try {
            Intent pick = new Intent(Intent.ACTION_GET_CONTENT);
            pick.addCategory(Intent.CATEGORY_OPENABLE);
            pick.setType("audio/*");
            pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            startActivityForResult(Intent.createChooser(pick, "Choose audio files"), REQ_FILES);
            return true;
        } catch (Exception e) {
            fileCallback = null;
            Toast.makeText(this, "Could not open the file picker.", Toast.LENGTH_SHORT).show();
            return false;
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_DICTATE) {
            String text = "";
            if (resultCode == RESULT_OK && data != null) {
                ArrayList<String> r = data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
                if (r != null && !r.isEmpty()) text = r.get(0);
            }
            try { emit(new JSONObject().put("type", "dictation").put("text", text).toString()); } catch (Exception ignored) { }
            return;
        }
        if (requestCode != REQ_FILES) {
            super.onActivityResult(requestCode, resultCode, data);
            return;
        }
        Uri[] result = null;
        if (resultCode == RESULT_OK && data != null) {
            if (data.getClipData() != null) {
                ClipData clip = data.getClipData();
                result = new Uri[clip.getItemCount()];
                for (int i = 0; i < clip.getItemCount(); i++) result[i] = clip.getItemAt(i).getUri();
            } else if (data.getData() != null) result = new Uri[]{data.getData()};
        }
        if (fileCallback != null) fileCallback.onReceiveValue(result);
        fileCallback = null;
    }

    @Override
    public void onBackPressed() {
        String js = "(function(){return !!(window.echoBack&&window.echoBack());})()";
        web.evaluateJavascript(js, handled -> {
            if ("true".equals(handled)) return;
            if (web.canGoBack()) web.goBack();
            else moveTaskToBack(true);
        });
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    protected void onPause() {
        super.onPause();
        // Keep the page running while a recording is going, so its clock and markers stay current.
        if (RecorderService.currentId() == null) web.onPause();
        CookieManager.getInstance().flush();
    }

    @Override
    protected void onResume() {
        super.onResume();
        current = new WeakReference<>(this);
        web.onResume();
    }

    @Override
    protected void onDestroy() {
        if (current.get() == this) current = new WeakReference<>(null);
        if (web != null) web.destroy();
        super.onDestroy();
    }
}
