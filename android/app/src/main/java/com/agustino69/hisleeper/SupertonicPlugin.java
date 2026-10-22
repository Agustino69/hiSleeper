package com.agustino69.hisleeper;

import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;
import java.util.Random;
import org.json.JSONException;

/** Voces naturales Supertonic 3 con ONNX Runtime nativo (rápido y sin conexión). */
@CapacitorPlugin(name = "Supertonic")
public class SupertonicPlugin extends Plugin {
    private static final String[] FILES = { "duration_predictor.onnx", "text_encoder.onnx", "vector_estimator.onnx", "vocoder.onnx" };
    private SupertonicEngine engine;
    private volatile boolean downloading = false;

    private File dir() {
        return new File(getContext().getFilesDir(), "supertonic3-int8");
    }

    private boolean ready() {
        for (String f : FILES) {
            File file = new File(dir(), f);
            if (!file.isFile() || file.length() == 0) return false;
        }
        return true;
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject r = new JSObject();
        r.put("ready", ready());
        r.put("downloading", downloading);
        call.resolve(r);
    }

    @PluginMethod
    public void download(PluginCall call) {
        String base = call.getString("baseUrl");
        if (base == null) {
            call.reject("Falta la URL de descarga");
            return;
        }
        if (downloading) {
            call.reject("Ya se está descargando");
            return;
        }
        downloading = true;
        new Thread(() -> {
            try {
                File d = dir();
                if (!d.isDirectory() && !d.mkdirs()) throw new Exception("No se pudo crear la carpeta de voces");
                long[] sizes = new long[FILES.length];
                long[] done = new long[FILES.length];
                for (int i = 0; i < FILES.length; i++) {
                    File target = new File(d, FILES[i]);
                    if (target.isFile() && target.length() > 0) {
                        sizes[i] = done[i] = target.length();
                        continue;
                    }
                    HttpURLConnection c = (HttpURLConnection) new URL(base + "/onnx/" + FILES[i]).openConnection();
                    c.setInstanceFollowRedirects(true);
                    c.connect();
                    if (c.getResponseCode() / 100 != 2) throw new Exception("Descarga fallida (" + c.getResponseCode() + ")");
                    sizes[i] = c.getContentLengthLong();
                    File part = new File(d, FILES[i] + ".part");
                    try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(part)) {
                        byte[] buf = new byte[1 << 16];
                        int n;
                        long lastEmit = 0;
                        while ((n = in.read(buf)) > 0) {
                            out.write(buf, 0, n);
                            done[i] += n;
                            long now = System.currentTimeMillis();
                            if (now - lastEmit > 250) {
                                lastEmit = now;
                                emitProgress(done, sizes);
                            }
                        }
                    }
                    if (!part.renameTo(target)) throw new Exception("No se pudo guardar " + FILES[i]);
                }
                emitProgress(done, sizes);
                call.resolve();
            } catch (Exception e) {
                call.reject("No se pudo descargar: " + e.getMessage());
            } finally {
                downloading = false;
            }
        }).start();
    }

    private void emitProgress(long[] done, long[] sizes) {
        long l = 0, t = 0;
        for (int i = 0; i < done.length; i++) {
            l += done[i];
            t += Math.max(sizes[i], done[i]);
        }
        JSObject p = new JSObject();
        p.put("loaded", l);
        p.put("total", t);
        notifyListeners("progress", p);
    }

    @PluginMethod
    public void remove(PluginCall call) {
        closeEngine();
        File[] files = dir().listFiles();
        if (files != null) for (File f : files) f.delete();
        call.resolve();
    }

    @PluginMethod
    public void synth(PluginCall call) {
        new Thread(() -> {
            try {
                if (!ready()) throw new Exception("Las voces naturales no están descargadas");
                synchronized (this) {
                    if (engine == null) {
                        JSObject cfg = call.getObject("config");
                        int threads = Math.min(4, Math.max(1, Runtime.getRuntime().availableProcessors()));
                        engine = new SupertonicEngine(
                            dir(),
                            cfg.getInt("sampleRate"),
                            cfg.getInt("baseChunkSize"),
                            cfg.getInt("chunkCompress"),
                            cfg.getInt("latentDim"),
                            threads
                        );
                    }
                    float[] pcm = engine.synth(
                        longs(call.getArray("ids")),
                        floats(call.getString("ttl")),
                        longs(call.getArray("ttlDims")),
                        floats(call.getString("dp")),
                        longs(call.getArray("dpDims")),
                        call.getInt("steps", 8),
                        call.getFloat("speed", 1f),
                        call.getFloat("temperature", 1f),
                        new Random()
                    );
                    ByteBuffer bb = ByteBuffer.allocate(pcm.length * 2).order(ByteOrder.LITTLE_ENDIAN);
                    for (float x : pcm) bb.putShort((short) Math.max(-32768, Math.min(32767, Math.round(x * 32767))));
                    JSObject r = new JSObject();
                    r.put("pcm", Base64.encodeToString(bb.array(), Base64.NO_WRAP));
                    r.put("sampleRate", engine.sampleRate);
                    call.resolve(r);
                }
            } catch (Throwable e) {
                call.reject("Error al generar la voz: " + e.getMessage());
            }
        }).start();
    }

    private static long[] longs(JSArray a) throws JSONException {
        long[] out = new long[a.length()];
        for (int i = 0; i < out.length; i++) out[i] = a.getLong(i);
        return out;
    }

    /** Float32 little-endian en base64. */
    private static float[] floats(String b64) {
        FloatBuffer fb = ByteBuffer.wrap(Base64.decode(b64, Base64.DEFAULT)).order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer();
        float[] out = new float[fb.remaining()];
        fb.get(out);
        return out;
    }

    private synchronized void closeEngine() {
        if (engine == null) return;
        try {
            engine.close();
        } catch (Exception ignored) {}
        engine = null;
    }

    @Override
    protected void handleOnDestroy() {
        closeEngine();
    }
}
