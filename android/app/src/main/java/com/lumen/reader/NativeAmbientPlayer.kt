package com.lumen.reader

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import java.util.Random
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

/**
 * 原生 Android 锁屏伴读环境声景混音播放器 v2：
 * - PCM 缓冲区在后台线程异步合成并按类型缓存，绝不阻塞主线程
 * - 暂停时仅调用 AudioTrack.pause()（<1ms），恢复瞬时无缝，彻底消除播放/暂停切换卡顿
 * - 6 秒余弦交叉淡变无缝循环，息屏锁屏下持续混音
 */
class NativeAmbientPlayer {

    private val workerScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val pcmCache = ConcurrentHashMap<String, ShortArray>()
    private val lock = Any()

    @Volatile
    private var track: AudioTrack? = null
    @Volatile
    private var currentType: String = "none"
    @Volatile
    private var currentVolume: Float = 0.25f
    @Volatile
    private var desiredPlaying: Boolean = false
    @Volatile
    private var loadToken: Int = 0
    private var prepareJob: Job? = null

    companion object {
        private const val SAMPLE_RATE = 22050
        private const val LOOP_SECONDS = 6
        private const val FRAME_COUNT = SAMPLE_RATE * LOOP_SECONDS
    }

    fun start(type: String, volume: Float) {
        val cleanType = type.trim().lowercase()
        val clampedVol = volume.coerceIn(0.0f, 1.0f)
        currentVolume = clampedVol

        if (cleanType.isEmpty() || cleanType == "none" || clampedVol <= 0.005f) {
            stop()
            return
        }

        desiredPlaying = true

        synchronized(lock) {
            val existing = track
            if (existing != null && currentType == cleanType) {
                runCatching {
                    existing.setVolume(clampedVol)
                    if (existing.playState != AudioTrack.PLAYSTATE_PLAYING) {
                        existing.play()
                    }
                }
                return
            }
        }

        val token = ++loadToken
        prepareJob?.cancel()
        prepareJob = workerScope.launch {
            val pcm = pcmCache[cleanType] ?: synthesizeSeamlessLoop(cleanType).also {
                pcmCache[cleanType] = it
            }
            if (token != loadToken || !desiredPlaying) return@launch

            synchronized(lock) {
                if (token != loadToken || !desiredPlaying) return@launch
                releaseTrackLocked()
                currentType = cleanType
                runCatching {
                    val byteCount = pcm.size * 2
                    val attrs = AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                        .build()
                    val fmt = AudioFormat.Builder()
                        .setSampleRate(SAMPLE_RATE)
                        .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                        .setChannelMask(AudioFormat.CHANNEL_OUT_STEREO)
                        .build()

                    val at = AudioTrack.Builder()
                        .setAudioAttributes(attrs)
                        .setAudioFormat(fmt)
                        .setBufferSizeInBytes(byteCount)
                        .setTransferMode(AudioTrack.MODE_STATIC)
                        .build()

                    at.write(pcm, 0, pcm.size)
                    at.setLoopPoints(0, FRAME_COUNT, -1)
                    at.setVolume(currentVolume)
                    at.play()
                    track = at
                }
            }
        }
    }

    /** 瞬时暂停（保留已创建的 AudioTrack 与 PCM 缓存，恢复播报零延迟） */
    fun pause() {
        desiredPlaying = false
        synchronized(lock) {
            track?.let { at ->
                runCatching {
                    if (at.playState == AudioTrack.PLAYSTATE_PLAYING) {
                        at.pause()
                    }
                }
            }
        }
    }

    fun setVolume(volume: Float) {
        currentVolume = volume.coerceIn(0.0f, 1.0f)
        synchronized(lock) {
            runCatching {
                track?.setVolume(currentVolume)
            }
        }
    }

    fun stop() {
        desiredPlaying = false
        loadToken++
        prepareJob?.cancel()
        prepareJob = null
        synchronized(lock) {
            releaseTrackLocked()
            currentType = "none"
        }
    }

    private fun releaseTrackLocked() {
        track?.let { at ->
            runCatching {
                if (at.playState == AudioTrack.PLAYSTATE_PLAYING) {
                    at.stop()
                }
                at.release()
            }
        }
        track = null
    }

    fun release() {
        stop()
        workerScope.cancel()
        pcmCache.clear()
    }

    private fun synthesizeSeamlessLoop(type: String): ShortArray {
        val rng = Random(type.hashCode().toLong() * 31L + 1337L)
        val left = FloatArray(FRAME_COUNT)
        val right = FloatArray(FRAME_COUNT)

        var b0L = 0.0; var b1L = 0.0; var b2L = 0.0
        var b0R = 0.0; var b1R = 0.0; var b2R = 0.0
        var brownL = 0.0; var brownR = 0.0
        var lpL = 0.0; var lpR = 0.0

        for (i in 0 until FRAME_COUNT) {
            val wL = rng.nextDouble() * 2.0 - 1.0
            val wR = rng.nextDouble() * 2.0 - 1.0

            when (type) {
                "rain" -> {
                    b0L = 0.997 * b0L + wL * 0.029
                    b1L = 0.985 * b1L + wL * 0.032
                    b2L = 0.950 * b2L + wL * 0.048
                    b0R = 0.997 * b0R + wR * 0.029
                    b1R = 0.985 * b1R + wR * 0.032
                    b2R = 0.950 * b2R + wR * 0.048
                    val swell = 0.85 + 0.15 * sin(2.0 * PI * i / FRAME_COUNT.toDouble())
                    val drop = if (rng.nextDouble() < 0.0014) (rng.nextDouble() - 0.5) * 0.35 else 0.0
                    left[i] = ((b0L + b1L + b2L + wL * 0.05 + drop) * 0.58 * swell).toFloat()
                    right[i] = ((b0R + b1R + b2R + wR * 0.05 - drop * 0.6) * 0.58 * swell).toFloat()
                }
                "fireplace" -> {
                    brownL = (brownL + 0.024 * wL) / 1.024
                    brownR = (brownR + 0.024 * wR) / 1.024
                    val crackle = if (rng.nextDouble() < 0.00055) (rng.nextDouble() * 2.0 - 1.0) * 0.42 else 0.0
                    lpL = lpL * 0.82 + (brownL * 2.6 + crackle) * 0.18
                    lpR = lpR * 0.82 + (brownR * 2.6 + crackle * 0.7) * 0.18
                    left[i] = lpL.toFloat()
                    right[i] = lpR.toFloat()
                }
                "vinyl" -> {
                    lpL = lpL * 0.76 + wL * 0.055
                    lpR = lpR * 0.76 + wR * 0.055
                    val tick = if (rng.nextDouble() < 0.00045) (rng.nextDouble() * 2.0 - 1.0) * 0.32 else 0.0
                    val hum = 0.015 * sin(2.0 * PI * 60.0 * i / SAMPLE_RATE.toDouble())
                    left[i] = (lpL + tick + hum).toFloat()
                    right[i] = (lpR + tick * 0.8 + hum).toFloat()
                }
                else -> {
                    brownL = (brownL + 0.02 * wL) / 1.02
                    brownR = (brownR + 0.02 * wR) / 1.02
                    left[i] = (brownL * 2.5).toFloat()
                    right[i] = (brownR * 2.5).toFloat()
                }
            }
        }

        val fade = SAMPLE_RATE / 4
        for (i in 0 until fade) {
            val t = i.toDouble() / fade.toDouble()
            val wIn = (0.5 - 0.5 * cos(PI * t)).toFloat()
            val wOut = 1.0f - wIn
            val tailIdx = FRAME_COUNT - fade + i
            left[i] = left[i] * wIn + left[tailIdx] * wOut
            right[i] = right[i] * wIn + right[tailIdx] * wOut
        }

        val out = ShortArray(FRAME_COUNT * 2)
        for (i in 0 until FRAME_COUNT) {
            val l = max(-0.92f, min(0.92f, left[i]))
            val r = max(-0.92f, min(0.92f, right[i]))
            out[i * 2] = (l * 32767.0f).toInt().toShort()
            out[i * 2 + 1] = (r * 32767.0f).toInt().toShort()
        }
        return out
    }
}
