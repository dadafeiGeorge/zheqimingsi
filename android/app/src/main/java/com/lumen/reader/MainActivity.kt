package com.lumen.reader

import android.Manifest
import android.annotation.SuppressLint
import android.content.ContentValues
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.speech.tts.TextToSpeech
import android.util.Base64
import java.util.Locale
import android.view.HapticFeedbackConstants
import android.view.KeyEvent
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewAssetLoader
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import org.json.JSONObject

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var ttsAuditionEngine: MicrosoftTtsEngine
    private val uiScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var auditionPlayer: MediaPlayer? = null
    private var auditionSystemTts: TextToSpeech? = null
    @Volatile
    private var auditionSystemTtsReady = false
    private var volumeKeyTurnEnabled = false
    private var filePathCallback: ValueCallback<Array<Uri>>? = null

    private val filePickerLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val cb = filePathCallback ?: return@registerForActivityResult
        filePathCallback = null
        val uri = result.data?.data
        if (result.resultCode == RESULT_OK && uri != null) {
            cb.onReceiveValue(arrayOf(uri))
        } else {
            cb.onReceiveValue(null)
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // 保持系统状态栏与导航栏清晰贴合，读取上次保存的主题底色以彻底消除冷启动白屏闪烁
        WindowCompat.setDecorFitsSystemWindows(window, true)
        val themePrefs = getSharedPreferences("lumen_ui_prefs", MODE_PRIVATE)
        val savedBgHex = themePrefs.getString("bgColorHex", "#F7F3EB") ?: "#F7F3EB"
        val savedIsDark = themePrefs.getBoolean("isDark", false)
        val initColor = runCatching { Color.parseColor(savedBgHex) }.getOrDefault(Color.parseColor("#F7F3EB"))
        runCatching {
            window.decorView.setBackgroundColor(initColor)
            window.statusBarColor = initColor
            window.navigationBarColor = initColor
            val ctrl = WindowInsetsControllerCompat(window, window.decorView)
            ctrl.isAppearanceLightStatusBars = !savedIsDark
            ctrl.isAppearanceLightNavigationBars = !savedIsDark
        }

        ttsAuditionEngine = MicrosoftTtsEngine(this)
        requestNotificationPermissionIfNeeded()

        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        webView = WebView(this).apply {
            setBackgroundColor(initColor)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.allowFileAccess = false
            settings.allowContentAccess = true
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            settings.cacheMode = WebSettings.LOAD_DEFAULT
            // 锁定 WebView 缩放基准，防止系统大字体/双击缩放破坏阅读分页与排版布局
            settings.textZoom = 100
            settings.setSupportZoom(false)
            settings.builtInZoomControls = false
            settings.displayZoomControls = false
            settings.useWideViewPort = true
            settings.loadWithOverviewMode = true
            isHorizontalScrollBarEnabled = false
            overScrollMode = WebView.OVER_SCROLL_NEVER

            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(
                    view: WebView,
                    request: WebResourceRequest
                ): WebResourceResponse? {
                    val resp = assetLoader.shouldInterceptRequest(request.url)
                    if (resp != null && request.url.path?.endsWith(".woff2", ignoreCase = true) == true) {
                        resp.mimeType = "font/woff2"
                    }
                    return resp
                }
            }

            webChromeClient = object : WebChromeClient() {
                override fun onShowFileChooser(
                    webView: WebView?,
                    filePathCallback: ValueCallback<Array<Uri>>?,
                    fileChooserParams: FileChooserParams?
                ): Boolean {
                    this@MainActivity.filePathCallback?.onReceiveValue(null)
                    this@MainActivity.filePathCallback = filePathCallback
                    val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                        addCategory(Intent.CATEGORY_OPENABLE)
                        type = "*/*"
                    }
                    return try {
                        filePickerLauncher.launch(intent)
                        true
                    } catch (_: Exception) {
                        this@MainActivity.filePathCallback = null
                        false
                    }
                }
            }

            addJavascriptInterface(AndroidJsBridge(), "AndroidBridge")
        }

        setContentView(webView)

        // 统一接管系统返回键与全面屏边缘侧滑返回：交由前端分层返回栈按层级关闭弹窗/抽屉/页面，绝不误退软件
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                webView.evaluateJavascript(
                    "(function(){ try { return window.__handleAndroidBack ? window.__handleAndroidBack() : 'exit'; } catch(e) { return 'exit'; } })()"
                ) { raw ->
                    val action = raw?.trim()?.trim('"') ?: "exit"
                    when (action) {
                        "consumed" -> {
                            // 前端已消费该次返回事件（关闭弹窗/面板/目录或返回上级页面）
                        }
                        "exit_background" -> {
                            moveTaskToBack(true)
                        }
                        else -> {
                            if (RadioForegroundService.isActivePlayback) {
                                moveTaskToBack(true)
                            } else {
                                finish()
                            }
                        }
                    }
                }
            }
        })

        RadioForegroundService.eventCallback = { json ->
            val escaped = JSONObject.quote(json.toString())
            runOnUiThread {
                webView.evaluateJavascript(
                    "window.__onAndroidRadioEvent && window.__onAndroidRadioEvent(JSON.parse($escaped));",
                    null
                )
            }
        }

        webView.loadUrl("https://appassets.androidplatform.net/assets/web/index.html")
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED
            ) {
                ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.POST_NOTIFICATIONS), 101)
            }
        }
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (volumeKeyTurnEnabled) {
            if (keyCode == KeyEvent.KEYCODE_VOLUME_DOWN) {
                webView.evaluateJavascript("window.__onAndroidVolumeKey && window.__onAndroidVolumeKey('down');", null)
                return true
            }
            if (keyCode == KeyEvent.KEYCODE_VOLUME_UP) {
                webView.evaluateJavascript("window.__onAndroidVolumeKey && window.__onAndroidVolumeKey('up');", null)
                return true
            }
        }
        return super.onKeyDown(keyCode, event)
    }

    override fun onResume() {
        super.onResume()
        // 息屏或切后台恢复时主动拉通原生电台状态（防止后台自动切章后 UI 滞后）
        if (::webView.isInitialized) {
            webView.evaluateJavascript(
                "window.__syncAndroidRadioState && window.__syncAndroidRadioState();",
                null
            )
        }
    }

    override fun onDestroy() {
        RadioForegroundService.eventCallback = null
        auditionPlayer?.release()
        runCatching {
            auditionSystemTts?.stop()
            auditionSystemTts?.shutdown()
        }
        auditionSystemTts = null
        uiScope.cancel()
        super.onDestroy()
    }

    private fun startRadioService(intent: Intent) {
        runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ContextCompat.startForegroundService(this, intent)
            } else {
                startService(intent)
            }
        }
    }

    private fun sendToRunningRadioService(intent: Intent) {
        if (!RadioForegroundService.isRunning) return
        runCatching {
            startService(intent)
        }
    }

    inner class AndroidJsBridge {

        @JavascriptInterface
        fun getAppVersion(): String = "1.0.0"

        @JavascriptInterface
        fun setStatusBarTheme(isDark: Boolean, bgColorHex: String) {
            runCatching {
                getSharedPreferences("lumen_ui_prefs", MODE_PRIVATE)
                    .edit()
                    .putString("bgColorHex", bgColorHex)
                    .putBoolean("isDark", isDark)
                    .apply()
            }
            runOnUiThread {
                runCatching {
                    val color = Color.parseColor(bgColorHex)
                    window.decorView.setBackgroundColor(color)
                    webView.setBackgroundColor(color)
                    window.statusBarColor = color
                    window.navigationBarColor = color
                    val controller = WindowInsetsControllerCompat(window, window.decorView)
                    controller.isAppearanceLightStatusBars = !isDark
                    controller.isAppearanceLightNavigationBars = !isDark
                }
            }
        }

        @JavascriptInterface
        fun setImmersiveFullscreen(on: Boolean) {
            runOnUiThread {
                runCatching {
                    val controller = WindowInsetsControllerCompat(window, window.decorView)
                    if (on) {
                        controller.systemBarsBehavior =
                            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                        controller.hide(WindowInsetsCompat.Type.systemBars())
                    } else {
                        controller.show(WindowInsetsCompat.Type.systemBars())
                    }
                }
            }
        }

        @JavascriptInterface
        fun setKeepScreenOn(on: Boolean) {
            runOnUiThread {
                if (on) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            }
        }

        @JavascriptInterface
        fun setVolumeKeyTurn(on: Boolean) {
            volumeKeyTurnEnabled = on
        }

        @JavascriptInterface
        fun hapticTick() {
            runOnUiThread {
                webView.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
            }
        }

        @JavascriptInterface
        fun showToast(msg: String) {
            runOnUiThread {
                Toast.makeText(this@MainActivity, msg, Toast.LENGTH_SHORT).show()
            }
        }

        @JavascriptInterface
        fun radioPlayTrack(payloadJson: String) {
            val intent = Intent(this@MainActivity, RadioForegroundService::class.java).apply {
                action = RadioForegroundService.ACTION_PLAY_TRACK
                putExtra(RadioForegroundService.EXTRA_JSON, payloadJson)
            }
            startRadioService(intent)
        }

        @JavascriptInterface
        fun radioPause() {
            val svc = RadioForegroundService.activeInstance
            if (svc != null) {
                svc.postPause()
            } else {
                sendToRunningRadioService(Intent(this@MainActivity, RadioForegroundService::class.java).setAction(RadioForegroundService.ACTION_PAUSE))
            }
        }

        @JavascriptInterface
        fun radioResume() {
            val svc = RadioForegroundService.activeInstance
            if (svc != null) {
                svc.postResume()
            } else if (RadioForegroundService.isRunning) {
                startRadioService(Intent(this@MainActivity, RadioForegroundService::class.java).setAction(RadioForegroundService.ACTION_RESUME))
            }
        }

        @JavascriptInterface
        fun radioStop() {
            val svc = RadioForegroundService.activeInstance
            if (svc != null) {
                svc.postStop()
            } else {
                sendToRunningRadioService(Intent(this@MainActivity, RadioForegroundService::class.java).setAction(RadioForegroundService.ACTION_STOP))
            }
        }

        @JavascriptInterface
        fun radioJumpBlock(index: Int) {
            val svc = RadioForegroundService.activeInstance
            if (svc != null) {
                svc.postJump(index, 0.0)
            } else {
                val intent = Intent(this@MainActivity, RadioForegroundService::class.java).apply {
                    action = RadioForegroundService.ACTION_JUMP
                    putExtra(RadioForegroundService.EXTRA_INDEX, index)
                }
                sendToRunningRadioService(intent)
            }
        }

        @JavascriptInterface
        fun radioJumpToSegmentWithTime(index: Int, startTimeSec: Double) {
            val svc = RadioForegroundService.activeInstance
            if (svc != null) {
                svc.postJump(index, startTimeSec)
            } else {
                val intent = Intent(this@MainActivity, RadioForegroundService::class.java).apply {
                    action = RadioForegroundService.ACTION_JUMP
                    putExtra(RadioForegroundService.EXTRA_INDEX, index)
                    putExtra(RadioForegroundService.EXTRA_TARGET_SEC, startTimeSec)
                }
                sendToRunningRadioService(intent)
            }
        }

        @JavascriptInterface
        fun radioUpdateConfig(configJson: String) {
            val svc = RadioForegroundService.activeInstance
            if (svc != null) {
                svc.postUpdateConfig(configJson)
            } else {
                val intent = Intent(this@MainActivity, RadioForegroundService::class.java).apply {
                    action = RadioForegroundService.ACTION_UPDATE_CONFIG
                    putExtra(RadioForegroundService.EXTRA_JSON, configJson)
                }
                sendToRunningRadioService(intent)
            }
        }

        @JavascriptInterface
        fun radioSeekBy(deltaSec: Double) {
            val svc = RadioForegroundService.activeInstance
            if (svc != null) {
                svc.postSeekBy(deltaSec)
            } else {
                val intent = Intent(this@MainActivity, RadioForegroundService::class.java).apply {
                    action = RadioForegroundService.ACTION_SEEK_BY
                    putExtra(RadioForegroundService.EXTRA_DELTA_SEC, deltaSec)
                }
                sendToRunningRadioService(intent)
            }
        }

        @JavascriptInterface
        fun radioSeekTo(targetSec: Double) {
            val svc = RadioForegroundService.activeInstance
            if (svc != null) {
                svc.postSeekTo(targetSec)
            } else {
                val intent = Intent(this@MainActivity, RadioForegroundService::class.java).apply {
                    action = RadioForegroundService.ACTION_SEEK_TO
                    putExtra(RadioForegroundService.EXTRA_TARGET_SEC, targetSec)
                }
                sendToRunningRadioService(intent)
            }
        }

        @JavascriptInterface
        fun radioSetSleepTimer(sleepEndAtMs: Long, sleepAfterChapter: Boolean) {
            val svc = RadioForegroundService.activeInstance
            if (svc != null) {
                svc.postSetSleepTimer(sleepEndAtMs, sleepAfterChapter)
            } else if (RadioForegroundService.isRunning) {
                val intent = Intent(this@MainActivity, RadioForegroundService::class.java).apply {
                    action = RadioForegroundService.ACTION_SET_SLEEP
                    putExtra(RadioForegroundService.EXTRA_SLEEP_END_AT, sleepEndAtMs)
                    putExtra(RadioForegroundService.EXTRA_SLEEP_AFTER_CHAPTER, sleepAfterChapter)
                }
                sendToRunningRadioService(intent)
            }
        }

        @JavascriptInterface
        fun radioGetState(): String {
            return RadioForegroundService.getSnapshotJson(this@MainActivity)
        }

        @JavascriptInterface
        fun ttsPrefetchSegment(
            text: String,
            voice: String,
            rate: Double,
            pitch: Int,
            azureKey: String,
            azureRegion: String
        ) {
            uiScope.launch {
                runCatching {
                    ttsAuditionEngine.synthesizeToFile(text, voice, rate, pitch, azureKey, azureRegion)
                }
            }
        }

        @JavascriptInterface
        fun ttsGetCacheStats(): String {
            return ttsAuditionEngine.getCacheStatsJson()
        }

        @JavascriptInterface
        fun ttsClearCache() {
            ttsAuditionEngine.clearCache()
        }

        @JavascriptInterface
        fun ttsGetSystemEngineName(): String {
            return runCatching {
                val engine = auditionSystemTts
                val defPkg = engine?.defaultEngine
                if (!defPkg.isNullOrBlank()) {
                    val info = engine.engines.firstOrNull { it.name == defPkg }
                    info?.label?.takeIf { it.isNotBlank() } ?: defPkg
                } else {
                    // 即使尚未初始化试听实例，也通过系统 Settings.Secure 读取当前默认系统 TTS 包名并解析中文应用名
                    val pkg = android.provider.Settings.Secure.getString(
                        contentResolver,
                        "tts_default_synth"
                    )
                    if (!pkg.isNullOrBlank()) {
                        val pm = packageManager
                        val ai = pm.getApplicationInfo(pkg, 0)
                        pm.getApplicationLabel(ai).toString()
                    } else {
                        "系统默认语音引擎"
                    }
                }
            }.getOrDefault("系统默认语音引擎")
        }

        @JavascriptInterface
        fun ttsAudition(
            text: String,
            voice: String,
            rate: Double,
            pitch: Int,
            azureKey: String,
            azureRegion: String
        ) {
            uiScope.launch {
                if (voice == "system-tts") {
                    runCatching {
                        val speakNow: (TextToSpeech) -> Unit = { engine ->
                            // 尊重手机系统默认 TTS 引擎与默认发音人，不强行覆盖已选好的系统语音
                            runCatching {
                                if (engine.voice == null) {
                                    val avail = engine.isLanguageAvailable(Locale.SIMPLIFIED_CHINESE)
                                    if (avail >= TextToSpeech.LANG_AVAILABLE) {
                                        engine.language = Locale.SIMPLIFIED_CHINESE
                                    }
                                }
                            }
                            engine.setSpeechRate(rate.toFloat().coerceIn(0.5f, 2.0f))
                            engine.setPitch((1.0f + pitch / 50.0f).coerceIn(0.6f, 1.5f))
                            engine.speak(text, TextToSpeech.QUEUE_FLUSH, null, "audition_sys_${System.currentTimeMillis()}")
                        }
                        val existing = auditionSystemTts
                        if (existing != null && auditionSystemTtsReady) {
                            speakNow(existing)
                        } else {
                            auditionSystemTts = TextToSpeech(this@MainActivity) { status ->
                                if (status == TextToSpeech.SUCCESS) {
                                    auditionSystemTtsReady = true
                                    auditionSystemTts?.let(speakNow)
                                } else {
                                    Toast.makeText(this@MainActivity, "系统默认语音引擎不可用，请检查手机文字转语音设置", Toast.LENGTH_SHORT).show()
                                }
                            }
                        }
                    }.onFailure { e ->
                        Toast.makeText(this@MainActivity, "系统语音试听失败：${e.message}", Toast.LENGTH_SHORT).show()
                    }
                    return@launch
                }
                try {
                    val file = ttsAuditionEngine.synthesizeToFile(text, voice, rate, pitch, azureKey, azureRegion)
                    auditionPlayer?.release()
                    auditionPlayer = MediaPlayer().apply {
                        setAudioAttributes(
                            AudioAttributes.Builder()
                                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                                .setUsage(AudioAttributes.USAGE_MEDIA)
                                .build()
                        )
                        setDataSource(file.absolutePath)
                        prepare()
                        start()
                    }
                } catch (e: Exception) {
                    Toast.makeText(this@MainActivity, "试听失败：${e.message}", Toast.LENGTH_SHORT).show()
                }
            }
        }

        @JavascriptInterface
        fun saveImageBase64(base64Png: String, fileName: String): Boolean {
            return try {
                val bytes = Base64.decode(base64Png, Base64.DEFAULT)
                val values = ContentValues().apply {
                    put(MediaStore.Images.Media.DISPLAY_NAME, fileName)
                    put(MediaStore.Images.Media.MIME_TYPE, "image/png")
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        put(MediaStore.Images.Media.RELATIVE_PATH, "${Environment.DIRECTORY_PICTURES}/哲启明思")
                    }
                }
                val uri = contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values) ?: return false
                contentResolver.openOutputStream(uri)?.use { it.write(bytes) }
                true
            } catch (_: Exception) {
                false
            }
        }
    }
}
