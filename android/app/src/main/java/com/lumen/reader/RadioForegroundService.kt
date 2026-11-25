package com.lumen.reader

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import androidx.media.app.NotificationCompat.MediaStyle
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.Locale

/**
 * 哲启明思电台原生后台前台服务 v2：
 * - 持有 PARTIAL_WAKE_LOCK + WifiLock + MediaPlayer.setWakeMode + FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK，彻底解决息屏停播
 * - 复用单一 AudioFocusRequest，彻底修复每段重新申请音频焦点引发系统 AUDIOFOCUS_LOSS 自杀停播的致命 Bug
 * - 原生跨章自动加载（NativeLibraryLoader）+ 原生睡眠定时，息屏 WebView 休眠时照常连播下一章
 * - 零卡顿暂停/恢复（直连主线程 Handler + NativeAmbientPlayer.pause + 状态机防竞态 + 保留当前进度）
 * - 原生 SharedPreferences 实时断点持久化，随时重开无损续播
 */
class RadioForegroundService : Service() {

    data class Segment(val blockIndex: Int, val text: String)

    data class QueueEntry(val bookId: String, val chapterIndex: Int)

    data class TtsConfig(
        val voice: String = "zh-CN-YunyangNeural",
        val rate: Double = 1.0,
        val pitch: Int = 0,
        val volume: Double = 1.0,
        val paraPauseMs: Long = 520L,
        val ambientSound: String = "none",
        val ambientVolume: Double = 0.25,
        val azureKey: String = "",
        val azureRegion: String = "eastasia",
    )

    companion object {
        const val CHANNEL_ID = "lumen_radio_playback"
        const val NOTIF_ID = 20261
        private const val PREFS_NAME = "lumen_radio_checkpoint_prefs"
        private const val KEY_CHECKPOINT_JSON = "last_checkpoint_json"

        const val ACTION_PLAY_TRACK = "com.lumen.reader.ACTION_PLAY_TRACK"
        const val ACTION_PAUSE = "com.lumen.reader.ACTION_PAUSE"
        const val ACTION_RESUME = "com.lumen.reader.ACTION_RESUME"
        const val ACTION_STOP = "com.lumen.reader.ACTION_STOP"
        const val ACTION_NEXT = "com.lumen.reader.ACTION_NEXT"
        const val ACTION_PREV = "com.lumen.reader.ACTION_PREV"
        const val ACTION_JUMP = "com.lumen.reader.ACTION_JUMP"
        const val ACTION_UPDATE_CONFIG = "com.lumen.reader.ACTION_UPDATE_CONFIG"
        const val ACTION_SEEK_BY = "com.lumen.reader.ACTION_SEEK_BY"
        const val ACTION_SEEK_TO = "com.lumen.reader.ACTION_SEEK_TO"
        const val ACTION_SET_SLEEP = "com.lumen.reader.ACTION_SET_SLEEP"

        const val EXTRA_JSON = "extra_json"
        const val EXTRA_INDEX = "extra_index"
        const val EXTRA_DELTA_SEC = "extra_delta_sec"
        const val EXTRA_TARGET_SEC = "extra_target_sec"
        const val EXTRA_SLEEP_END_AT = "extra_sleep_end_at"
        const val EXTRA_SLEEP_AFTER_CHAPTER = "extra_sleep_after_chapter"

        @Volatile
        var activeInstance: RadioForegroundService? = null

        @Volatile
        var eventCallback: ((JSONObject) -> Unit)? = null

        @Volatile
        var isRunning: Boolean = false

        @Volatile
        var isActivePlayback: Boolean = false

        /** 供 MainActivity 随时获取实时状态或最近一次原生持久化断点 */
        fun getSnapshotJson(context: Context): String {
            activeInstance?.let { svc ->
                return svc.buildSnapshotJson().toString()
            }
            val saved = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .getString(KEY_CHECKPOINT_JSON, null)
            if (!saved.isNullOrBlank()) {
                return runCatching {
                    JSONObject(saved).put("isRunning", false).toString()
                }.getOrDefault("{}")
            }
            return "{}"
        }
    }

    private val mainHandler = Handler(Looper.getMainLooper())
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private lateinit var tts: MicrosoftTtsEngine
    private lateinit var mediaSession: MediaSessionCompat
    private lateinit var audioManager: AudioManager
    private val ambientPlayer = NativeAmbientPlayer()

    private var wakeLock: PowerManager.WakeLock? = null
    private var wifiLock: WifiManager.WifiLock? = null
    private var audioFocusRequest: AudioFocusRequest? = null
    @Volatile
    private var hasAudioFocus = false
    @Volatile
    private var pausedByTransientFocusLoss = false
    @Volatile
    private var isDucked = false
    private var noisyReceiverRegistered = false

    private var mediaPlayer: MediaPlayer? = null
    @Volatile
    private var mediaPlayerPrepared = false
    @Volatile
    private var mediaPlayerCompleted = false

    private var playJob: Job? = null
    private var prefetchJob: Job? = null
    private var nextSegmentJob: Job? = null
    private var progressJob: Job? = null
    private var watchdogJob: Job? = null
    private var sleepTimerJob: Job? = null

    private var offlineTts: TextToSpeech? = null
    @Volatile
    private var offlineTtsReady = false
    @Volatile
    private var isOfflineFallback = false

    private var stationId = "current"
    private var bookId = ""
    private var bookTitle = "哲启明思电台"
    private var author = "微软神经网络语音"
    private var chapterIndex = 0
    private var chapterCount = 0
    private var chapterTitle = ""
    private var totalBlocks = 0
    private var announceChapter = true
    private var queueItems: List<QueueEntry> = emptyList()

    private var segments: List<Segment> = emptyList()
    private var cursor = 0
    private var config = TtsConfig()
    private var currentStatus = "idle"
    @Volatile
    private var desiredPlaying = false
    private var sessionToken = 0
    private var consecutiveErrors = 0
    private var lastPositionSec = 0.0
    private var lastDurationSec = 0.0
    private var sleepEndAtMs = 0L
    private var sleepAfterChapter = false
    private var lastCheckpointSavedAt = 0L
    private var foregroundStarted = false

    private val noisyReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY) {
                if (currentStatus == "playing" || currentStatus == "loading") {
                    pausePlayback()
                }
            }
        }
    }

    private val focusListener = AudioManager.OnAudioFocusChangeListener { change ->
        when (change) {
            AudioManager.AUDIOFOCUS_LOSS -> {
                hasAudioFocus = false
                pausedByTransientFocusLoss = false
                isDucked = false
                if (currentStatus == "playing" || currentStatus == "loading") {
                    pausePlayback()
                }
            }
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> {
                if (currentStatus == "playing" || currentStatus == "loading") {
                    pausedByTransientFocusLoss = true
                    pausePlayback(keepAudioFocus = true)
                }
            }
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> {
                if (currentStatus == "playing") {
                    isDucked = true
                    applyEffectiveVolume()
                }
            }
            AudioManager.AUDIOFOCUS_GAIN -> {
                hasAudioFocus = true
                if (isDucked) {
                    isDucked = false
                    applyEffectiveVolume()
                }
                if (pausedByTransientFocusLoss && currentStatus == "paused") {
                    pausedByTransientFocusLoss = false
                    resumePlayback()
                }
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        activeInstance = this
        isRunning = true
        isActivePlayback = false
        tts = MicrosoftTtsEngine(this)
        audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager

        // 创建单一可复用 AudioFocusRequest，彻底避免每段切歌自发 AUDIOFOCUS_LOSS 导致停播
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            audioFocusRequest = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build()
                )
                .setWillPauseWhenDucked(false)
                .setOnAudioFocusChangeListener(focusListener, mainHandler)
                .build()
        }

        // 初始化 CPU WakeLock 与 WiFi Lock（息屏后保持段间切换与网络 TTS 不断连）
        runCatching {
            val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "LumenReader:RadioPlaybackWakeLock").apply {
                setReferenceCounted(false)
            }
        }
        runCatching {
            val wm = applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
            val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                WifiManager.WIFI_MODE_FULL_LOW_LATENCY
            } else {
                @Suppress("DEPRECATION")
                WifiManager.WIFI_MODE_FULL_HIGH_PERF
            }
            wifiLock = wm?.createWifiLock(mode, "LumenReader:RadioWifiLock")?.apply {
                setReferenceCounted(false)
            }
        }

        createNotificationChannel()
        initOfflineTts()

        mediaSession = MediaSessionCompat(this, "LumenPhilosophyRadio").apply {
            setCallback(object : MediaSessionCompat.Callback() {
                override fun onPlay() = resumePlayback()
                override fun onPause() = pausePlayback()
                override fun onSkipToNext() = skipNextSegment()
                override fun onSkipToPrevious() = skipPrevSegment()
                override fun onStop() = stopPlayback()
            })
            isActive = true
        }
    }

    private fun acquireWakeLocks() {
        runCatching {
            wakeLock?.let { wl ->
                // 每次续期 60 分钟，既保证息屏不休眠又防止极端泄漏
                wl.acquire(60L * 60L * 1000L)
            }
        }
        if (config.voice != "system-tts") {
            runCatching {
                wifiLock?.let { wfl ->
                    if (!wfl.isHeld) wfl.acquire()
                }
            }
        }
    }

    private fun releaseWakeLocks() {
        runCatching {
            wakeLock?.let { wl -> if (wl.isHeld) wl.release() }
        }
        runCatching {
            wifiLock?.let { wfl -> if (wfl.isHeld) wfl.release() }
        }
    }

    private fun registerNoisyReceiverIfNeeded() {
        if (noisyReceiverRegistered) return
        runCatching {
            val filter = IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY)
            ContextCompat.registerReceiver(this, noisyReceiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED)
            noisyReceiverRegistered = true
        }
    }

    private fun unregisterNoisyReceiver() {
        if (!noisyReceiverRegistered) return
        runCatching { unregisterReceiver(noisyReceiver) }
        noisyReceiverRegistered = false
    }

    private fun ensureForeground(isPlaying: Boolean) {
        val notif = buildNotification(isPlaying)
        if (!foregroundStarted) {
            runCatching {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ServiceCompat.startForeground(
                        this,
                        NOTIF_ID,
                        notif,
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
                    )
                } else {
                    startForeground(NOTIF_ID, notif)
                }
                foregroundStarted = true
            }
        } else {
            runCatching {
                val nm = getSystemService(NotificationManager::class.java)
                nm.notify(NOTIF_ID, notif)
            }
        }
    }

    private fun initOfflineTts() {
        runCatching {
            offlineTts = TextToSpeech(this) { status ->
                if (status == TextToSpeech.SUCCESS) {
                    val engine = offlineTts
                    runCatching {
                        if (engine != null && engine.voice == null) {
                            val avail = engine.isLanguageAvailable(Locale.SIMPLIFIED_CHINESE)
                            if (avail >= TextToSpeech.LANG_AVAILABLE) {
                                engine.language = Locale.SIMPLIFIED_CHINESE
                            }
                        }
                    }
                    offlineTtsReady = true
                }
            }
        }
    }

    private fun applyEffectiveVolume() {
        val factor = if (isDucked) 0.25f else 1.0f
        val v = (config.volume.toFloat() * factor).coerceIn(0.0f, 1.0f)
        runCatching { mediaPlayer?.setVolume(v, v) }
        ambientPlayer.setVolume((config.ambientVolume.toFloat() * factor).coerceIn(0.0f, 1.0f))
    }

    private fun syncNativeAmbient() {
        if (config.ambientSound == "none" || config.ambientSound.isBlank()) {
            ambientPlayer.stop()
            return
        }
        val factor = if (isDucked) 0.25f else 1.0f
        val vol = (config.ambientVolume.toFloat() * factor).coerceIn(0.0f, 1.0f)
        when {
            currentStatus == "playing" || (currentStatus == "loading" && desiredPlaying) -> {
                ambientPlayer.start(config.ambientSound, vol)
            }
            currentStatus == "paused" -> {
                // 仅暂停 AudioTrack，不释放不重建，恢复瞬间无缝零卡顿
                ambientPlayer.pause()
            }
            else -> {
                ambientPlayer.stop()
            }
        }
    }

    private fun startProgressTicker(seg: Segment, token: Int) {
        progressJob?.cancel()
        progressJob = scope.launch {
            while (isActive && token == sessionToken && desiredPlaying) {
                delay(500L)
                val mp = mediaPlayer ?: break
                if (currentStatus == "playing" && mediaPlayerPrepared) {
                    val playingNow = runCatching { mp.isPlaying }.getOrDefault(false)
                    if (playingNow) {
                        val cur = runCatching { mp.currentPosition / 1000.0 }.getOrDefault(lastPositionSec)
                        val dur = runCatching { mp.duration / 1000.0 }.getOrDefault(lastDurationSec)
                        if (dur > 0.0) {
                            lastPositionSec = cur
                            lastDurationSec = dur
                            emitState(seg, null, cur, dur)
                            persistCheckpoint(force = false)
                        }
                    }
                }
            }
        }
    }

    private fun startWatchdog(token: Int, timeoutMs: Long) {
        watchdogJob?.cancel()
        watchdogJob = scope.launch {
            delay(timeoutMs)
            if (token != sessionToken || !desiredPlaying) return@launch
            // 若单段长时间卡在 loading 或离线 TTS 未回调 onDone，自动跳过恢复连播
            if (currentStatus == "loading" || isOfflineFallback) {
                consecutiveErrors++
                if (consecutiveErrors <= 3 && cursor + 1 < segments.size) {
                    sessionToken++
                    startSegment(cursor + 1, sessionToken, 0.0, 0)
                }
            }
        }
    }

    private fun startSleepTimerMonitor() {
        sleepTimerJob?.cancel()
        if (sleepEndAtMs <= 0L) return
        sleepTimerJob = scope.launch {
            val waitMs = sleepEndAtMs - System.currentTimeMillis()
            if (waitMs > 0) delay(waitMs)
            if (sleepEndAtMs > 0L && System.currentTimeMillis() >= sleepEndAtMs - 200L) {
                sleepEndAtMs = 0L
                sleepAfterChapter = false
                if (currentStatus == "playing" || currentStatus == "loading") {
                    pausePlayback()
                }
                emitEvent(JSONObject().put("type", "sleepTriggered"))
            }
        }
    }

    /* ---------- 供 MainActivity 主线程直调的零延迟接口 ---------- */

    fun postPause() = mainHandler.post { pausePlayback() }
    fun postResume() = mainHandler.post { resumePlayback() }
    fun postStop() = mainHandler.post { stopPlayback() }
    fun postJump(index: Int, startTimeSec: Double = 0.0) = mainHandler.post {
        jumpToSegment(index, startTimeSec)
    }
    fun postSeekBy(deltaSec: Double) = mainHandler.post { seekBySeconds(deltaSec) }
    fun postSeekTo(targetSec: Double) = mainHandler.post { seekToSeconds(targetSec) }
    fun postUpdateConfig(rawJson: String) = mainHandler.post {
        runCatching { applyConfig(JSONObject(rawJson)) }
    }
    fun postSetSleepTimer(endAtMs: Long, afterChapter: Boolean) = mainHandler.post {
        sleepEndAtMs = endAtMs
        sleepAfterChapter = afterChapter
        startSleepTimerMonitor()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_PLAY_TRACK -> {
                ensureForeground(true)
                val raw = intent.getStringExtra(EXTRA_JSON)
                if (raw != null) {
                    runCatching { handlePlayTrack(raw) }
                }
            }
            ACTION_PAUSE -> pausePlayback()
            ACTION_RESUME -> {
                ensureForeground(true)
                resumePlayback()
            }
            ACTION_STOP -> stopPlayback()
            ACTION_NEXT -> skipNextSegment()
            ACTION_PREV -> skipPrevSegment()
            ACTION_JUMP -> {
                val idx = intent.getIntExtra(EXTRA_INDEX, 0)
                val startSec = intent.getDoubleExtra(EXTRA_TARGET_SEC, 0.0)
                jumpToSegment(idx, startSec)
            }
            ACTION_UPDATE_CONFIG -> {
                val raw = intent.getStringExtra(EXTRA_JSON)
                if (!raw.isNullOrBlank()) runCatching { applyConfig(JSONObject(raw)) }
            }
            ACTION_SEEK_BY -> {
                val delta = intent.getDoubleExtra(EXTRA_DELTA_SEC, 0.0)
                seekBySeconds(delta)
            }
            ACTION_SEEK_TO -> {
                val target = intent.getDoubleExtra(EXTRA_TARGET_SEC, 0.0)
                seekToSeconds(target)
            }
            ACTION_SET_SLEEP -> {
                sleepEndAtMs = intent.getLongExtra(EXTRA_SLEEP_END_AT, 0L)
                sleepAfterChapter = intent.getBooleanExtra(EXTRA_SLEEP_AFTER_CHAPTER, false)
                startSleepTimerMonitor()
            }
            else -> {
                if (!foregroundStarted) ensureForeground(currentStatus == "playing")
            }
        }
        return START_NOT_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        persistCheckpoint(force = true)
        activeInstance = null
        isRunning = false
        isActivePlayback = false
        foregroundStarted = false
        playJob?.cancel()
        prefetchJob?.cancel()
        nextSegmentJob?.cancel()
        progressJob?.cancel()
        watchdogJob?.cancel()
        sleepTimerJob?.cancel()
        unregisterNoisyReceiver()
        abandonAudioFocus()
        releaseWakeLocks()
        ambientPlayer.release()
        runCatching {
            offlineTts?.stop()
            offlineTts?.shutdown()
        }
        offlineTts = null
        releasePlayer(stopOfflineTts = true)
        mediaSession.release()
        scope.cancel()
        super.onDestroy()
    }

    private fun jumpToSegment(idx: Int, startTimeSec: Double = 0.0) {
        if (idx !in segments.indices) return
        if (idx == cursor && startTimeSec <= 0.05 && currentStatus == "playing") return
        desiredPlaying = true
        consecutiveErrors = 0
        sessionToken++
        startSegment(idx, sessionToken, startTimeSec.coerceAtLeast(0.0), 0)
    }

    private fun seekBySeconds(deltaSec: Double) {
        val mp = mediaPlayer
        if (mp != null && mediaPlayerPrepared && !isOfflineFallback) {
            val dur = runCatching { mp.duration }.getOrDefault(0)
            val pos = runCatching { mp.currentPosition }.getOrDefault(0)
            if (dur > 0) {
                val nextMs = pos + (deltaSec * 1000.0).toInt()
                if (nextMs < 0) {
                    if (pos > 2500) {
                        mp.seekTo(0)
                        lastPositionSec = 0.0
                        segments.getOrNull(cursor)?.let { emitState(it, null, 0.0, dur / 1000.0) }
                        persistCheckpoint(force = true)
                    } else {
                        skipPrevSegment()
                    }
                } else if (nextMs >= dur - 150) {
                    skipNextSegment()
                } else {
                    mp.seekTo(nextMs)
                    lastPositionSec = nextMs / 1000.0
                    lastDurationSec = dur / 1000.0
                    segments.getOrNull(cursor)?.let { emitState(it, null, lastPositionSec, lastDurationSec) }
                    persistCheckpoint(force = true)
                }
                return
            }
        }
        if (deltaSec > 0) skipNextSegment() else if (deltaSec < 0) skipPrevSegment()
    }

    private fun seekToSeconds(targetSec: Double) {
        val mp = mediaPlayer ?: return
        if (!mediaPlayerPrepared || isOfflineFallback) return
        val dur = runCatching { mp.duration }.getOrDefault(0)
        if (dur <= 0) return
        val clampedMs = (targetSec * 1000.0).toInt().coerceIn(0, maxOf(0, dur - 50))
        runCatching { mp.seekTo(clampedMs) }
        lastPositionSec = clampedMs / 1000.0
        lastDurationSec = dur / 1000.0
        segments.getOrNull(cursor)?.let { emitState(it, null, lastPositionSec, lastDurationSec) }
        persistCheckpoint(force = true)
    }

    private fun applyConfig(obj: JSONObject, restartIfPlaying: Boolean = true) {
        val oldVoice = config.voice
        val oldRate = config.rate
        val oldPitch = config.pitch
        config = TtsConfig(
            voice = obj.optString("voice", config.voice),
            rate = obj.optDouble("rate", config.rate),
            pitch = obj.optInt("pitch", config.pitch),
            volume = obj.optDouble("volume", config.volume),
            paraPauseMs = obj.optLong("paraPauseMs", config.paraPauseMs),
            ambientSound = obj.optString("ambientSound", config.ambientSound),
            ambientVolume = obj.optDouble("ambientVolume", config.ambientVolume),
            azureKey = obj.optString("azureKey", config.azureKey),
            azureRegion = obj.optString("azureRegion", config.azureRegion),
        )
        applyEffectiveVolume()
        syncNativeAmbient()
        if (restartIfPlaying && currentStatus == "playing" &&
            (oldVoice != config.voice || oldRate != config.rate || oldPitch != config.pitch)
        ) {
            sessionToken++
            startSegment(cursor, sessionToken, 0.0, 0)
        }
    }

    private fun handlePlayTrack(rawJson: String) {
        val obj = JSONObject(rawJson)
        stationId = obj.optString("stationId", "current")
        bookId = obj.optString("bookId", "")
        bookTitle = obj.optString("bookTitle", "哲启明思电台")
        author = obj.optString("author", "")
        chapterIndex = obj.optInt("chapterIndex", 0)
        chapterCount = obj.optInt("chapterCount", 0)
        chapterTitle = obj.optString("chapterTitle", "")
        totalBlocks = obj.optInt("totalBlocks", 0)
        announceChapter = obj.optBoolean("announceChapter", true)
        sleepEndAtMs = obj.optLong("sleepEndAt", sleepEndAtMs)
        sleepAfterChapter = obj.optBoolean("sleepAfterChapter", sleepAfterChapter)
        obj.optJSONObject("config")?.let { applyConfig(it, restartIfPlaying = false) }

        val qArr = obj.optJSONArray("queue")
        if (qArr != null) {
            val qList = ArrayList<QueueEntry>(qArr.length())
            for (i in 0 until qArr.length()) {
                val qi = qArr.optJSONObject(i) ?: continue
                val bid = qi.optString("bookId", "")
                if (bid.isNotBlank()) qList.add(QueueEntry(bid, qi.optInt("chapterIndex", 0)))
            }
            queueItems = qList
        }

        val arr = obj.optJSONArray("segments") ?: JSONArray()
        val list = ArrayList<Segment>(arr.length())
        for (i in 0 until arr.length()) {
            val s = arr.getJSONObject(i)
            list.add(Segment(s.optInt("blockIndex", i), s.optString("text", "")))
        }
        segments = list
        cursor = obj.optInt("startIndex", 0).coerceIn(0, maxOf(0, segments.lastIndex))
        val startTimeSec = obj.optDouble("startTimeSec", 0.0).coerceAtLeast(0.0)

        desiredPlaying = true
        consecutiveErrors = 0
        pausedByTransientFocusLoss = false
        sessionToken++
        startSleepTimerMonitor()
        updateMediaSessionMetadata()
        ensureForeground(true)
        if (segments.isNotEmpty()) {
            startSegment(cursor, sessionToken, startTimeSec, 0)
        }
    }

    private fun startSegment(index: Int, token: Int, startTimeSec: Double = 0.0, retryCount: Int = 0) {
        if (token != sessionToken || !desiredPlaying) return
        playJob?.cancel()
        nextSegmentJob?.cancel()
        progressJob?.cancel()
        watchdogJob?.cancel()

        if (index !in segments.indices) {
            handleChapterEnd(token)
            return
        }

        val isContinuousSystemTts = config.voice == "system-tts" && isOfflineFallback
        // 系统 TTS 连续段过渡时不提前调 stop()，直接用 QUEUE_FLUSH 避免部分国产机型 TTS 丢句
        releasePlayer(stopOfflineTts = !isContinuousSystemTts)

        cursor = index
        val seg = segments[index]
        lastPositionSec = startTimeSec
        lastDurationSec = 0.0
        acquireWakeLocks()
        registerNoisyReceiverIfNeeded()

        val cfgSnap = config
        val isCachedHit = cfgSnap.voice != "system-tts" &&
            retryCount == 0 &&
            tts.isCached(seg.text, cfgSnap.voice, cfgSnap.rate, cfgSnap.pitch)

        if (!isCachedHit && currentStatus != "playing") {
            currentStatus = "loading"
            emitState(seg, null, startTimeSec, 0.0)
            ensureForeground(true)
        } else {
            emitState(seg, null, startTimeSec, 0.0)
        }
        persistCheckpoint(force = true)

        if (cfgSnap.voice == "system-tts") {
            playJob = scope.launch {
                var waited = 0
                while (!offlineTtsReady && waited < 2400 && token == sessionToken && desiredPlaying) {
                    delay(100)
                    waited += 100
                }
                if (token != sessionToken || !desiredPlaying) return@launch
                if (!speakWithOfflineFallback(seg, token)) {
                    isOfflineFallback = false
                    desiredPlaying = false
                    currentStatus = "error"
                    releaseWakeLocks()
                    syncNativeAmbient()
                    emitState(seg, "系统本地语音引擎尚未就绪，请在手机设置中检查文字转语音引擎", 0.0, 0.0)
                    ensureForeground(false)
                }
            }
            return
        }

        // 串行后台预取后 2 段，既保证无缝衔接又防止多路并发抢占微软连接
        prefetchJob?.cancel()
        prefetchJob = scope.launch(Dispatchers.IO) {
            for (offset in 1..2) {
                if (!isActive || token != sessionToken) break
                val nxt = segments.getOrNull(index + offset) ?: break
                runCatching {
                    tts.synthesizeToFile(nxt.text, cfgSnap.voice, cfgSnap.rate, cfgSnap.pitch, cfgSnap.azureKey, cfgSnap.azureRegion)
                }
            }
        }

        startWatchdog(token, 32_000L)

        playJob = scope.launch {
            try {
                val file: File = tts.synthesizeToFile(
                    seg.text,
                    cfgSnap.voice,
                    cfgSnap.rate,
                    cfgSnap.pitch,
                    cfgSnap.azureKey,
                    cfgSnap.azureRegion,
                    forceRefresh = retryCount > 0
                )
                if (token != sessionToken || !desiredPlaying) return@launch
                isOfflineFallback = false
                playAudioFile(file, seg, token, startTimeSec, retryCount)
            } catch (e: Exception) {
                if (token != sessionToken || !desiredPlaying) return@launch
                if (speakWithOfflineFallback(seg, token)) {
                    return@launch
                }
                consecutiveErrors++
                if (consecutiveErrors <= 2 && cursor + 1 < segments.size) {
                    delay(400L)
                    if (token == sessionToken && desiredPlaying) {
                        startSegment(cursor + 1, token, 0.0, 0)
                        return@launch
                    }
                }
                isOfflineFallback = false
                desiredPlaying = false
                currentStatus = "error"
                releaseWakeLocks()
                syncNativeAmbient()
                emitState(seg, e.message ?: "无法连接微软语音服务，请检查网络", 0.0, 0.0)
                ensureForeground(false)
            }
        }
    }

    /** 章节播完后：优先在原生层直接加载下一章（息屏时 WebView 休眠照样顺滑切章不断播！） */
    private fun handleChapterEnd(token: Int) {
        if (sleepAfterChapter) {
            sleepAfterChapter = false
            sleepEndAtMs = 0L
            emitEvent(JSONObject().put("type", "sleepTriggered"))
            pausePlayback()
            return
        }

        // 漫游盲盒台由前端随机选书；若是单书连播或私人播单，直接原生加载下一章
        if (stationId == "roam") {
            emitEvent(JSONObject().put("type", "chapterComplete"))
            return
        }

        playJob = scope.launch {
            val loaded = withContext(Dispatchers.IO) {
                if (stationId == "queue" && queueItems.isNotEmpty()) {
                    val qIdx = queueItems.indexOfFirst { it.bookId == bookId && it.chapterIndex == chapterIndex }
                    if (qIdx >= 0 && qIdx + 1 < queueItems.size) {
                        val nxt = queueItems[qIdx + 1]
                        return@withContext NativeLibraryLoader.loadChapter(
                            applicationContext, nxt.bookId, nxt.chapterIndex, announceChapter
                        )
                    }
                }
                if (bookId.isNotBlank() && (chapterCount <= 0 || chapterIndex + 1 < chapterCount)) {
                    var nextCh = chapterIndex + 1
                    val limit = if (chapterCount > 0) chapterCount else nextCh + 8
                    while (nextCh < limit) {
                        val ch = NativeLibraryLoader.loadChapter(
                            applicationContext, bookId, nextCh, announceChapter
                        ) ?: break
                        if (ch.segments.isNotEmpty()) return@withContext ch
                        nextCh++
                    }
                }
                null
            }

            if (token != sessionToken || !desiredPlaying) return@launch
            if (loaded != null && loaded.segments.isNotEmpty()) {
                bookId = loaded.bookId
                bookTitle = loaded.bookTitle
                author = loaded.author
                chapterIndex = loaded.chapterIndex
                chapterCount = loaded.chapterCount
                chapterTitle = loaded.chapterTitle
                totalBlocks = loaded.totalBlocks
                segments = loaded.segments
                cursor = 0
                lastPositionSec = 0.0
                lastDurationSec = 0.0
                updateMediaSessionMetadata()
                persistCheckpoint(force = true)
                emitEvent(
                    JSONObject()
                        .put("type", "chapterChanged")
                        .put("bookId", bookId)
                        .put("bookTitle", bookTitle)
                        .put("author", author)
                        .put("chapterIndex", chapterIndex)
                        .put("chapterTitle", chapterTitle)
                        .put("blockIndex", loaded.segments[0].blockIndex)
                        .put("totalBlocks", totalBlocks)
                        .put("segmentIndex", 0)
                        .put("totalSegments", loaded.segments.size)
                        .put("text", loaded.segments[0].text)
                )
                startSegment(0, token, 0.0, 0)
            } else {
                // 书末或用户导入书籍：通知前端处理切书/停播
                emitEvent(JSONObject().put("type", "chapterComplete"))
            }
        }
    }

    private fun speakWithOfflineFallback(seg: Segment, token: Int): Boolean {
        val engine = offlineTts
        if (engine == null || !offlineTtsReady) return false
        return runCatching {
            requestAudioFocusIfNeeded()
            acquireWakeLocks()
            isOfflineFallback = true
            currentStatus = "playing"
            engine.setSpeechRate(config.rate.toFloat().coerceIn(0.5f, 2.0f))
            engine.setPitch((1.0f + config.pitch / 50.0f).coerceIn(0.6f, 1.5f))
            val uttId = "offline_${token}_${cursor}"
            val estMs = ((seg.text.length / (4.0 * config.rate.coerceAtLeast(0.5))) * 1000.0).toLong().coerceAtLeast(3000L)
            startWatchdog(token, estMs * 2 + 16_000L)

            engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                override fun onStart(utteranceId: String?) {}

                override fun onDone(utteranceId: String?) {
                    if (utteranceId != uttId) return
                    mainHandler.post {
                        if (token != sessionToken || !desiredPlaying) return@post
                        watchdogJob?.cancel()
                        consecutiveErrors = 0
                        nextSegmentJob?.cancel()
                        nextSegmentJob = scope.launch {
                            delay(config.paraPauseMs)
                            if (token == sessionToken && desiredPlaying) {
                                startSegment(cursor + 1, token, 0.0, 0)
                            }
                        }
                    }
                }

                @Deprecated("Deprecated in Java")
                override fun onError(utteranceId: String?) {
                    handleOfflineError(utteranceId, uttId, seg, token)
                }

                override fun onError(utteranceId: String?, errorCode: Int) {
                    handleOfflineError(utteranceId, uttId, seg, token)
                }
            })

            val params = Bundle().apply {
                putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, config.volume.toFloat().coerceIn(0.0f, 1.0f))
            }
            val code = engine.speak(seg.text, TextToSpeech.QUEUE_FLUSH, params, uttId)
            if (code == TextToSpeech.ERROR) return false
            syncNativeAmbient()
            emitState(seg, null, 0.0, 0.0)
            updatePlaybackState(PlaybackStateCompat.STATE_PLAYING)
            ensureForeground(true)
            true
        }.getOrDefault(false)
    }

    private fun handleOfflineError(utteranceId: String?, expectedId: String, seg: Segment, token: Int) {
        if (utteranceId != null && utteranceId != expectedId) return
        mainHandler.post {
            if (token != sessionToken || !desiredPlaying) return@post
            watchdogJob?.cancel()
            consecutiveErrors++
            if (consecutiveErrors <= 3 && cursor + 1 < segments.size) {
                nextSegmentJob?.cancel()
                nextSegmentJob = scope.launch {
                    delay(250L)
                    if (token == sessionToken && desiredPlaying) {
                        startSegment(cursor + 1, token, 0.0, 0)
                    }
                }
                return@post
            }
            desiredPlaying = false
            currentStatus = "error"
            releaseWakeLocks()
            syncNativeAmbient()
            emitState(seg, "离线本地语音播报失败，请检查系统文字转语音设置", 0.0, 0.0)
            ensureForeground(false)
        }
    }

    private fun playAudioFile(file: File, seg: Segment, token: Int, startTimeSec: Double, retryCount: Int) {
        requestAudioFocusIfNeeded()
        acquireWakeLocks()
        mediaPlayerPrepared = false
        mediaPlayerCompleted = false

        val mp = MediaPlayer().apply {
            // 为 MediaPlayer 绑定 CPU 唤醒锁，保证息屏后解码与播放回调不休眠
            setWakeMode(applicationContext, PowerManager.PARTIAL_WAKE_LOCK)
            setAudioAttributes(
                AudioAttributes.Builder()
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .build()
            )
            setDataSource(file.absolutePath)
            val factor = if (isDucked) 0.25f else 1.0f
            val vol = (config.volume.toFloat() * factor).coerceIn(0.0f, 1.0f)
            setVolume(vol, vol)
            setOnPreparedListener { player ->
                if (token != sessionToken || !desiredPlaying) {
                    runCatching { player.release() }
                    return@setOnPreparedListener
                }
                watchdogJob?.cancel()
                mediaPlayerPrepared = true
                mediaPlayerCompleted = false
                consecutiveErrors = 0
                val durMs = runCatching { player.duration }.getOrDefault(0)
                if (startTimeSec > 0.1 && durMs > 200) {
                    val seekMs = (startTimeSec * 1000.0).toInt().coerceIn(0, maxOf(0, durMs - 100))
                    runCatching { player.seekTo(seekMs) }
                    lastPositionSec = seekMs / 1000.0
                } else {
                    lastPositionSec = 0.0
                }
                lastDurationSec = durMs / 1000.0
                currentStatus = "playing"
                player.start()
                syncNativeAmbient()
                emitState(seg, null, lastPositionSec, lastDurationSec)
                startProgressTicker(seg, token)
                updatePlaybackState(PlaybackStateCompat.STATE_PLAYING)
                ensureForeground(true)
            }
            setOnCompletionListener {
                if (token != sessionToken) return@setOnCompletionListener
                progressJob?.cancel()
                mediaPlayerCompleted = true
                if (!desiredPlaying) return@setOnCompletionListener
                acquireWakeLocks()
                nextSegmentJob?.cancel()
                nextSegmentJob = scope.launch {
                    delay(config.paraPauseMs)
                    if (token == sessionToken && desiredPlaying) {
                        startSegment(cursor + 1, token, 0.0, 0)
                    }
                }
            }
            setOnErrorListener { _, _, _ ->
                if (token == sessionToken && desiredPlaying) {
                    progressJob?.cancel()
                    watchdogJob?.cancel()
                    mediaPlayerPrepared = false
                    // 删除可能损坏的缓存 MP3 并自动重建重试，绝不因单段损坏停播
                    tts.invalidateCache(seg.text, config.voice, config.rate, config.pitch)
                    if (retryCount < 1) {
                        startSegment(cursor, token, startTimeSec, retryCount + 1)
                        return@setOnErrorListener true
                    }
                    if (speakWithOfflineFallback(seg, token)) {
                        return@setOnErrorListener true
                    }
                    consecutiveErrors++
                    if (consecutiveErrors <= 2 && cursor + 1 < segments.size) {
                        startSegment(cursor + 1, token, 0.0, 0)
                        return@setOnErrorListener true
                    }
                    desiredPlaying = false
                    currentStatus = "error"
                    releaseWakeLocks()
                    syncNativeAmbient()
                    emitState(seg, "音频播放异常，请点击重试", lastPositionSec, lastDurationSec)
                    ensureForeground(false)
                }
                true
            }
            prepareAsync()
        }
        mediaPlayer = mp
    }

    private fun pausePlayback(keepAudioFocus: Boolean = false) {
        desiredPlaying = false
        if (currentStatus == "loading" || !mediaPlayerPrepared) {
            // 废止正在进行的合成或 prepareAsync，杜绝暂停后被回调重新拉起
            sessionToken++
        }
        playJob?.cancel()
        nextSegmentJob?.cancel()
        progressJob?.cancel()
        watchdogJob?.cancel()

        if (isOfflineFallback) {
            runCatching { offlineTts?.stop() }
        }
        mediaPlayer?.let { mp ->
            runCatching {
                if (mediaPlayerPrepared && mp.isPlaying) {
                    lastPositionSec = mp.currentPosition / 1000.0
                    lastDurationSec = mp.duration / 1000.0
                    mp.pause()
                }
            }
        }

        currentStatus = "paused"
        releaseWakeLocks()
        if (!keepAudioFocus) {
            pausedByTransientFocusLoss = false
        }
        syncNativeAmbient()
        // 关键修复：暂停时保留 lastPositionSec / lastDurationSec，绝不把进度条归零！
        segments.getOrNull(cursor)?.let { emitState(it, null, lastPositionSec, lastDurationSec) }
        persistCheckpoint(force = true)
        updatePlaybackState(PlaybackStateCompat.STATE_PAUSED)
        ensureForeground(false)
    }

    private fun resumePlayback() {
        desiredPlaying = true
        pausedByTransientFocusLoss = false
        val mp = mediaPlayer

        if (mediaPlayerCompleted && segments.isNotEmpty()) {
            mediaPlayerCompleted = false
            sessionToken++
            startSegment(cursor + 1, sessionToken, 0.0, 0)
            return
        }

        if (mp != null && mediaPlayerPrepared && !isOfflineFallback) {
            requestAudioFocusIfNeeded()
            acquireWakeLocks()
            registerNoisyReceiverIfNeeded()
            runCatching {
                mp.start()
                currentStatus = "playing"
                syncNativeAmbient()
                val cur = mp.currentPosition / 1000.0
                val dur = mp.duration / 1000.0
                lastPositionSec = cur
                lastDurationSec = dur
                segments.getOrNull(cursor)?.let {
                    emitState(it, null, cur, dur)
                    startProgressTicker(it, sessionToken)
                }
                updatePlaybackState(PlaybackStateCompat.STATE_PLAYING)
                ensureForeground(true)
            }.onFailure {
                sessionToken++
                startSegment(cursor, sessionToken, lastPositionSec, 0)
            }
        } else if (segments.isNotEmpty()) {
            sessionToken++
            startSegment(cursor, sessionToken, lastPositionSec, 0)
        }
    }

    private fun skipNextSegment() {
        if (cursor + 1 < segments.size) {
            desiredPlaying = true
            sessionToken++
            startSegment(cursor + 1, sessionToken, 0.0, 0)
        } else {
            emitEvent(JSONObject().put("type", "command").put("action", "next"))
        }
    }

    private fun skipPrevSegment() {
        if (cursor > 0) {
            desiredPlaying = true
            sessionToken++
            startSegment(cursor - 1, sessionToken, 0.0, 0)
        } else {
            emitEvent(JSONObject().put("type", "command").put("action", "prev"))
        }
    }

    private fun stopPlayback() {
        persistCheckpoint(force = true)
        desiredPlaying = false
        pausedByTransientFocusLoss = false
        sessionToken++
        playJob?.cancel()
        prefetchJob?.cancel()
        nextSegmentJob?.cancel()
        progressJob?.cancel()
        watchdogJob?.cancel()
        sleepTimerJob?.cancel()
        runCatching { offlineTts?.stop() }
        isOfflineFallback = false
        ambientPlayer.stop()
        releasePlayer(stopOfflineTts = true)
        unregisterNoisyReceiver()
        abandonAudioFocus()
        releaseWakeLocks()
        currentStatus = "idle"
        isActivePlayback = false
        foregroundStarted = false
        updatePlaybackState(PlaybackStateCompat.STATE_STOPPED)
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun releasePlayer(stopOfflineTts: Boolean) {
        progressJob?.cancel()
        mediaPlayerPrepared = false
        mediaPlayerCompleted = false
        if (stopOfflineTts) {
            runCatching { offlineTts?.stop() }
        }
        mediaPlayer?.let {
            runCatching {
                if (it.isPlaying) it.stop()
                it.release()
            }
        }
        mediaPlayer = null
    }

    /** 幂等获取音频焦点：已持有焦点时直接复用，彻底根除每段重新申请触发 AUDIOFOCUS_LOSS 的 Bug */
    private fun requestAudioFocusIfNeeded() {
        if (hasAudioFocus) return
        val res = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val req = audioFocusRequest ?: return
            audioManager.requestAudioFocus(req)
        } else {
            @Suppress("DEPRECATION")
            audioManager.requestAudioFocus(focusListener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN)
        }
        hasAudioFocus = (res == AudioManager.AUDIOFOCUS_REQUEST_GRANTED)
    }

    private fun abandonAudioFocus() {
        if (!hasAudioFocus) return
        runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                audioFocusRequest?.let { audioManager.abandonAudioFocusRequest(it) }
            } else {
                @Suppress("DEPRECATION")
                audioManager.abandonAudioFocus(focusListener)
            }
        }
        hasAudioFocus = false
    }

    private fun buildSnapshotJson(): JSONObject {
        val seg = segments.getOrNull(cursor)
        return JSONObject()
            .put("isRunning", isRunning)
            .put("status", currentStatus)
            .put("stationId", stationId)
            .put("bookId", bookId)
            .put("bookTitle", bookTitle)
            .put("author", author)
            .put("chapterIndex", chapterIndex)
            .put("chapterTitle", chapterTitle)
            .put("blockIndex", seg?.blockIndex ?: 0)
            .put("totalBlocks", totalBlocks)
            .put("segmentIndex", cursor)
            .put("totalSegments", segments.size)
            .put("text", seg?.text ?: "")
            .put("currentTime", lastPositionSec)
            .put("duration", lastDurationSec)
            .put("isOfflineFallback", isOfflineFallback)
            .put("updatedAt", System.currentTimeMillis())
    }

    private fun persistCheckpoint(force: Boolean) {
        if (bookId.isBlank()) return
        val now = System.currentTimeMillis()
        if (!force && now - lastCheckpointSavedAt < 4000L) return
        lastCheckpointSavedAt = now
        runCatching {
            getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_CHECKPOINT_JSON, buildSnapshotJson().toString())
                .apply()
        }
    }

    private fun emitState(seg: Segment, error: String?, curSec: Double = lastPositionSec, durSec: Double = lastDurationSec) {
        isActivePlayback = currentStatus == "playing" || currentStatus == "loading"
        val obj = JSONObject()
            .put("type", "state")
            .put("status", currentStatus)
            .put("blockIndex", seg.blockIndex)
            .put("segmentIndex", cursor)
            .put("totalSegments", segments.size)
            .put("text", seg.text)
            .put("currentTime", curSec)
            .put("duration", durSec)
            .put("isOfflineFallback", isOfflineFallback)
        if (error != null) obj.put("error", error)
        emitEvent(obj)
    }

    private fun emitEvent(obj: JSONObject) {
        eventCallback?.invoke(obj)
    }

    private fun updateMediaSessionMetadata() {
        mediaSession.setMetadata(
            MediaMetadataCompat.Builder()
                .putString(MediaMetadataCompat.METADATA_KEY_TITLE, bookTitle)
                .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, "$author · $chapterTitle")
                .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, "哲启明思电台 · 微软神经网络语音")
                .build()
        )
    }

    private fun updatePlaybackState(state: Int) {
        mediaSession.setPlaybackState(
            PlaybackStateCompat.Builder()
                .setActions(
                    PlaybackStateCompat.ACTION_PLAY or
                        PlaybackStateCompat.ACTION_PAUSE or
                        PlaybackStateCompat.ACTION_PLAY_PAUSE or
                        PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
                        PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or
                        PlaybackStateCompat.ACTION_STOP
                )
                .setState(state, (lastPositionSec * 1000.0).toLong(), config.rate.toFloat())
                .build()
        )
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(NotificationManager::class.java)
            val ch = NotificationChannel(
                CHANNEL_ID,
                "哲启明思电台播报",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "控制微软神经网络语音后台朗读"
                setShowBadge(false)
            }
            nm.createNotificationChannel(ch)
        }
    }

    private fun pendingServiceAction(action: String, code: Int): PendingIntent {
        val intent = Intent(this, RadioForegroundService::class.java).setAction(action)
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        return PendingIntent.getService(this, code, intent, flags)
    }

    private fun buildNotification(isPlaying: Boolean): Notification {
        val openIntent = Intent(this, MainActivity::class.java)
        val contentPi = PendingIntent.getActivity(
            this,
            0,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val toggleAction = if (isPlaying) {
            NotificationCompat.Action(android.R.drawable.ic_media_pause, "暂停", pendingServiceAction(ACTION_PAUSE, 2))
        } else {
            NotificationCompat.Action(android.R.drawable.ic_media_play, "播放", pendingServiceAction(ACTION_RESUME, 2))
        }

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(bookTitle)
            .setContentText(chapterTitle.ifBlank { author })
            .setSubText("哲启明思电台")
            .setContentIntent(contentPi)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(isPlaying)
            .addAction(android.R.drawable.ic_media_previous, "上一段", pendingServiceAction(ACTION_PREV, 1))
            .addAction(toggleAction)
            .addAction(android.R.drawable.ic_media_next, "下一段", pendingServiceAction(ACTION_NEXT, 3))
            .setStyle(
                MediaStyle()
                    .setMediaSession(mediaSession.sessionToken)
                    .setShowActionsInCompactView(0, 1, 2)
            )
            .build()
    }
}
