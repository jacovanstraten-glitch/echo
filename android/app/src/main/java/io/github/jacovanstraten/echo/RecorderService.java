package io.github.jacovanstraten.echo;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.MediaMetadataRetriever;
import android.media.MediaRecorder;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;

/**
 * Records audio in a foreground service, so recording continues with the screen locked or while
 * another app is open. Files are kept in the app's private storage (files/recordings) until the
 * web app has uploaded them to OneDrive and asks to remove them.
 */
public class RecorderService extends Service {

    static final String ACTION_SHOW = "io.github.jacovanstraten.echo.SHOW";
    static final String ACTION_STOP = "io.github.jacovanstraten.echo.STOP";
    private static final String CHANNEL = "recording";
    private static final int NOTIFICATION_ID = 7;

    // ----- recorder state (one recording at a time, shared with the activity's bridge) -----
    private static final Object LOCK = new Object();
    private static MediaRecorder rec;
    private static String id;
    private static File file;
    private static long startedAt, accumulated, segmentStart;
    private static boolean paused;
    private static PowerManager.WakeLock wakeLock;

    static File dir(Context c) {
        File d = new File(c.getFilesDir(), "recordings");
        //noinspection ResultOfMethodCallIgnored
        d.mkdirs();
        return d;
    }

    static String start(Context c, String newId) {
        synchronized (LOCK) {
            if (rec != null) return "A recording is already running.";
            String safeId = newId == null ? "" : newId.replaceAll("[^A-Za-z0-9_-]", "");
            if (safeId.isEmpty()) safeId = Long.toString(System.currentTimeMillis(), 36);
            File f = new File(dir(c), safeId + ".m4a");
            MediaRecorder r = Build.VERSION.SDK_INT >= 31 ? new MediaRecorder(c) : new MediaRecorder();
            try {
                r.setAudioSource(MediaRecorder.AudioSource.MIC);
                r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
                r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
                r.setAudioChannels(1);
                r.setAudioSamplingRate(32000);
                r.setAudioEncodingBitRate(64000);
                r.setOutputFile(f.getAbsolutePath());
                r.prepare();
                r.start();
            } catch (Exception e) {
                r.release();
                //noinspection ResultOfMethodCallIgnored
                f.delete();
                return "The microphone could not be started (" + e.getClass().getSimpleName() + ").";
            }
            rec = r;
            id = safeId;
            file = f;
            startedAt = System.currentTimeMillis();
            segmentStart = android.os.SystemClock.elapsedRealtime();
            accumulated = 0;
            paused = false;
            writeMeta(c, safeId, startedAt, 0, f.length(), false, null, ".m4a", "audio/mp4", true);
            PowerManager pm = (PowerManager) c.getSystemService(POWER_SERVICE);
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Echo:recording");
            wakeLock.acquire(12 * 60 * 60 * 1000L);
        }
        Intent svc = new Intent(c, RecorderService.class);
        if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(svc); else c.startService(svc);
        return "ok";
    }

    static long elapsed() {
        synchronized (LOCK) {
            if (rec == null) return 0;
            return accumulated + (paused ? 0 : android.os.SystemClock.elapsedRealtime() - segmentStart);
        }
    }

    static boolean pause(Context c) {
        synchronized (LOCK) {
            if (rec == null || paused) return false;
            try { rec.pause(); } catch (Exception e) { return false; }
            accumulated += android.os.SystemClock.elapsedRealtime() - segmentStart;
            paused = true;
        }
        updateNotification(c);
        return true;
    }

    static boolean resume(Context c) {
        synchronized (LOCK) {
            if (rec == null || !paused) return false;
            try { rec.resume(); } catch (Exception e) { return false; }
            segmentStart = android.os.SystemClock.elapsedRealtime();
            paused = false;
        }
        updateNotification(c);
        return true;
    }

    /** Stops the recording and returns its details as JSON, or null when nothing was recording. */
    static JSONObject stop(Context c) {
        JSONObject out;
        synchronized (LOCK) {
            if (rec == null) return null;
            long dur = elapsed();
            try { rec.stop(); } catch (Exception ignored) { }
            rec.release();
            rec = null;
            if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
            wakeLock = null;
            long real = durationOf(file);
            if (real > 0) dur = real;
            writeMeta(c, id, startedAt, dur, file.length(), false, null, ".m4a", "audio/mp4", false);
            out = metaJson(c, id);
            id = null;
            file = null;
            paused = false;
        }
        c.stopService(new Intent(c, RecorderService.class));
        MainActivity.emit("{\"type\":\"stopped\"}");
        return out;
    }

    static JSONObject status() {
        JSONObject o = new JSONObject();
        try {
            synchronized (LOCK) {
                o.put("state", rec == null ? "idle" : paused ? "paused" : "recording");
                if (rec != null) {
                    o.put("id", id);
                    o.put("elapsedMs", elapsed());
                    o.put("startedAt", startedAt);
                    double level = 0;
                    if (!paused) { try { level = rec.getMaxAmplitude() / 32767.0; } catch (Exception ignored) { } }
                    o.put("level", level);
                }
            }
        } catch (Exception ignored) { }
        return o;
    }

    static String currentId() { synchronized (LOCK) { return rec == null ? null : id; } }

    // ----- files -----
    static long durationOf(File f) {
        MediaMetadataRetriever m = new MediaMetadataRetriever();
        try {
            m.setDataSource(f.getAbsolutePath());
            String d = m.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
            return d == null ? 0 : Long.parseLong(d);
        } catch (Exception e) {
            return 0;
        } finally {
            try { m.release(); } catch (Exception ignored) { }
        }
    }

    static void writeMeta(Context c, String fileId, long createdAt, long durationMs, long size, boolean imported,
                          String title, String ext, String mime, boolean recording) {
        try {
            JSONObject o = new JSONObject();
            o.put("id", fileId);
            o.put("createdAt", createdAt);
            o.put("durationMs", durationMs);
            o.put("size", size);
            o.put("imported", imported);
            if (title != null) o.put("title", title);
            o.put("ext", ext);
            o.put("mime", mime);
            o.put("file", fileId + ext);
            o.put("recording", recording);
            try (FileOutputStream out = new FileOutputStream(new File(dir(c), fileId + ".json"))) {
                out.write(o.toString().getBytes(StandardCharsets.UTF_8));
            }
        } catch (Exception ignored) { }
    }

    static JSONObject metaJson(Context c, String fileId) {
        try {
            File m = new File(dir(c), fileId + ".json");
            byte[] b = java.nio.file.Files.readAllBytes(m.toPath());
            JSONObject o = new JSONObject(new String(b, StandardCharsets.UTF_8));
            File a = new File(dir(c), o.optString("file"));
            o.put("size", a.length());
            return o;
        } catch (Exception e) {
            return null;
        }
    }

    /** Finished recordings and imported files that are still on the phone. */
    static JSONArray list(Context c) {
        JSONArray arr = new JSONArray();
        File[] files = dir(c).listFiles((d, n) -> n.endsWith(".json"));
        String running = currentId();
        if (files == null) return arr;
        for (File m : files) {
            String fileId = m.getName().substring(0, m.getName().length() - 5);
            if (fileId.equals(running)) continue;
            JSONObject o = metaJson(c, fileId);
            if (o == null) continue;
            File a = new File(dir(c), o.optString("file"));
            if (!a.exists() || a.length() == 0) continue;
            try {
                if (o.optBoolean("recording")) { // the app was stopped while recording: recover what was saved
                    long d = durationOf(a);
                    o.put("recording", false);
                    o.put("durationMs", d);
                    writeMeta(c, fileId, o.optLong("createdAt"), d, a.length(), false, null, o.optString("ext", ".m4a"), o.optString("mime", "audio/mp4"), false);
                }
            } catch (Exception ignored) { }
            arr.put(o);
        }
        return arr;
    }

    static void remove(Context c, String fileId) {
        if (fileId == null || fileId.equals(currentId())) return;
        JSONObject o = metaJson(c, fileId);
        if (o != null) //noinspection ResultOfMethodCallIgnored
            new File(dir(c), o.optString("file")).delete();
        //noinspection ResultOfMethodCallIgnored
        new File(dir(c), fileId + ".json").delete();
    }

    // ----- foreground service -----
    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stop(this);
            stopSelf();
            return START_NOT_STICKY;
        }
        if (currentId() == null) {
            stopSelf();
            return START_NOT_STICKY;
        }
        Notification n = build(this);
        if (Build.VERSION.SDK_INT >= 30) startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
        else startForeground(NOTIFICATION_ID, n);
        return START_NOT_STICKY;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // Swiping Echo away from recent apps does not stop the recording; the notification stays.
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    private static Notification build(Context c) {
        NotificationManager nm = (NotificationManager) c.getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Recording", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Shown while Echo is recording");
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        int pf = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        Intent open = new Intent(c, MainActivity.class).setAction(ACTION_SHOW).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent openPi = PendingIntent.getActivity(c, 1, open, pf);
        PendingIntent stopPi = PendingIntent.getService(c, 2, new Intent(c, RecorderService.class).setAction(ACTION_STOP), pf);
        boolean isPaused;
        long el;
        synchronized (LOCK) { isPaused = paused; el = elapsed(); }
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(c, CHANNEL) : new Notification.Builder(c);
        b.setSmallIcon(R.drawable.ic_stat_mic)
                .setContentTitle(isPaused ? "Echo recording paused" : "Echo is recording")
                .setContentText("Tap to open. Stop saves the recording.")
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setContentIntent(openPi)
                .setColor(0xFF5B3FA0)
                .setCategory(Notification.CATEGORY_SERVICE)
                .addAction(new Notification.Action.Builder(null, "Stop", stopPi).build());
        if (!isPaused) {
            b.setUsesChronometer(true);
            b.setWhen(System.currentTimeMillis() - el);
            b.setShowWhen(true);
        }
        if (Build.VERSION.SDK_INT >= 31) b.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE);
        return b.build();
    }

    private static void updateNotification(Context c) {
        if (currentId() == null) return;
        NotificationManager nm = (NotificationManager) c.getSystemService(NOTIFICATION_SERVICE);
        try { nm.notify(NOTIFICATION_ID, build(c)); } catch (Exception ignored) { }
    }
}
