package com.agustino69.hisleeper;

import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtException;
import ai.onnxruntime.OrtSession;
import java.io.File;
import java.nio.FloatBuffer;
import java.nio.LongBuffer;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;
import java.util.Random;

/**
 * Supertonic 3 (Supertone, modelo OpenRAIL-M) con ONNX Runtime nativo: varios hilos y
 * núcleos int8 optimizados para ARM, mucho más rápido que en el navegador.
 * Pipeline: duración → codificador de texto → estimador vectorial ×N → vocoder.
 * Java puro (sin Android) para poder probarlo en la JVM.
 */
public final class SupertonicEngine implements AutoCloseable {
    private final OrtEnvironment env = OrtEnvironment.getEnvironment();
    private final OrtSession dp;
    private final OrtSession enc;
    private final OrtSession vec;
    private final OrtSession voc;
    public final int sampleRate;
    private final int chunk;
    private final int latentDim;

    public SupertonicEngine(File dir, int sampleRate, int baseChunkSize, int chunkCompress, int latentDim, int threads) throws OrtException {
        OrtSession.SessionOptions o = new OrtSession.SessionOptions();
        o.setIntraOpNumThreads(Math.max(1, threads));
        o.setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT);
        dp = env.createSession(new File(dir, "duration_predictor.onnx").getPath(), o);
        enc = env.createSession(new File(dir, "text_encoder.onnx").getPath(), o);
        vec = env.createSession(new File(dir, "vector_estimator.onnx").getPath(), o);
        voc = env.createSession(new File(dir, "vocoder.onnx").getPath(), o);
        this.sampleRate = sampleRate;
        this.chunk = baseChunkSize * chunkCompress;
        this.latentDim = latentDim * chunkCompress;
    }

    /**
     * @param ids         índices de caracteres ya normalizados (los calcula la app)
     * @param temperature escala del ruido inicial: más alta = entonación más variada
     */
    public float[] synth(
        long[] ids,
        float[] ttl,
        long[] ttlDims,
        float[] dpStyle,
        long[] dpDims,
        int steps,
        float speed,
        float temperature,
        Random rnd
    ) throws OrtException {
        int n = ids.length;
        float[] ones = new float[n];
        Arrays.fill(ones, 1f);
        try (
            OnnxTensor textIds = OnnxTensor.createTensor(env, LongBuffer.wrap(ids), new long[] { 1, n });
            OnnxTensor textMask = OnnxTensor.createTensor(env, FloatBuffer.wrap(ones), new long[] { 1, 1, n });
            OnnxTensor styleTtl = OnnxTensor.createTensor(env, FloatBuffer.wrap(ttl), ttlDims);
            OnnxTensor styleDp = OnnxTensor.createTensor(env, FloatBuffer.wrap(dpStyle), dpDims)
        ) {
            float duration;
            Map<String, OnnxTensor> in = new HashMap<>();
            in.put("text_ids", textIds);
            in.put("style_dp", styleDp);
            in.put("text_mask", textMask);
            try (OrtSession.Result r = dp.run(in)) {
                duration = ((OnnxTensor) r.get("duration").get()).getFloatBuffer().get(0) / speed;
            }

            in.clear();
            in.put("text_ids", textIds);
            in.put("style_ttl", styleTtl);
            in.put("text_mask", textMask);
            try (OrtSession.Result encOut = enc.run(in)) {
                OnnxTensor textEmb = (OnnxTensor) encOut.get("text_emb").get();
                int wavLen = (int) Math.floor(duration * sampleRate);
                int latentLen = Math.max(1, (wavLen + chunk - 1) / chunk);
                float[] xt = new float[latentDim * latentLen];
                for (int i = 0; i < xt.length; i++) xt[i] = (float) rnd.nextGaussian() * temperature;
                float[] lmask = new float[latentLen];
                Arrays.fill(lmask, 1f);
                long[] latentShape = { 1, latentDim, latentLen };
                try (
                    OnnxTensor latentMask = OnnxTensor.createTensor(env, FloatBuffer.wrap(lmask), new long[] { 1, 1, latentLen });
                    OnnxTensor total = OnnxTensor.createTensor(env, FloatBuffer.wrap(new float[] { steps }), new long[] { 1 })
                ) {
                    for (int step = 0; step < steps; step++) {
                        try (
                            OnnxTensor noisy = OnnxTensor.createTensor(env, FloatBuffer.wrap(xt), latentShape);
                            OnnxTensor current = OnnxTensor.createTensor(env, FloatBuffer.wrap(new float[] { step }), new long[] { 1 })
                        ) {
                            Map<String, OnnxTensor> v = new HashMap<>();
                            v.put("noisy_latent", noisy);
                            v.put("text_emb", textEmb);
                            v.put("style_ttl", styleTtl);
                            v.put("latent_mask", latentMask);
                            v.put("text_mask", textMask);
                            v.put("current_step", current);
                            v.put("total_step", total);
                            try (OrtSession.Result r = vec.run(v)) {
                                FloatBuffer fb = ((OnnxTensor) r.get("denoised_latent").get()).getFloatBuffer();
                                xt = new float[fb.remaining()];
                                fb.get(xt);
                            }
                        }
                    }
                }
                try (OnnxTensor latent = OnnxTensor.createTensor(env, FloatBuffer.wrap(xt), latentShape)) {
                    Map<String, OnnxTensor> v = new HashMap<>();
                    v.put("latent", latent);
                    try (OrtSession.Result r = voc.run(v)) {
                        FloatBuffer wav = ((OnnxTensor) r.get("wav_tts").get()).getFloatBuffer();
                        // El vocoder rellena hasta el final del bloque: se recorta a la duración prevista.
                        int len = Math.min(wav.remaining(), (int) Math.ceil(duration * sampleRate));
                        float[] out = new float[len];
                        wav.get(out, 0, len);
                        return out;
                    }
                }
            }
        }
    }

    @Override
    public void close() throws OrtException {
        dp.close();
        enc.close();
        vec.close();
        voc.close();
    }
}
