package com.lumen.reader

import android.content.Context
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.URLEncoder
import java.security.MessageDigest
import java.security.SecureRandom
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

/**
 * 原生 Kotlin 微软神经网络语音引擎 v2：
 * - 同文本并发去重（inFlight）+ 独立临时文件原子写入，彻底杜绝预取与播放竞争写坏 MP3
 * - 并发信号量限流（最多 2 路并发 WebSocket），避免触发微软服务端断连
 * - 最多 3 次退避重试，抵御手机切网/息屏瞬间抖动
 */
class MicrosoftTtsEngine(context: Context) {

    private val cacheDir = File(context.cacheDir, "tts_cache").apply { mkdirs() }
    private val rng = SecureRandom()
    private val inFlight = ConcurrentHashMap<String, CompletableDeferred<File>>()
    private val netSemaphore = Semaphore(2)

    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(15, TimeUnit.SECONDS)
        .pingInterval(15, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    companion object {
        private const val TRUSTED = "6A5AA1D4EAFF4E9FB37E23D68491D6F4"
        private const val GEC_VERSION = "2-143.0.3650.96"
        private const val UA =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0"
        private const val COPY = "Copyright (C) Microsoft Corporation. All rights reserved."
        private const val WS_BASE = "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1"

        private val SW1 = uintArrayOf(0xEF0569FBu, 0x76F50F34u, 0xC3EFEA97u)
        private val SW2 = uintArrayOf(0xC31713DBu, 0x1881CE3Cu, 0x35BD1EC9u)
        private val MIX1 = uintArrayOf(0xCF98B111u, 0x87085B9Fu, 0x12CEB96Du, 0x257E1D83u)
        private val MIX2 = uintArrayOf(0xA27416F5u, 0xD38396FFu, 0x7C932B89u, 0xBFA49F69u)

        private fun swap16(v: UInt): UInt = (v shl 16) or (v shr 16)

        private fun swapTerm(word: UInt, key: UInt, m: UIntArray): UInt {
            val sum = (word * key) + (swap16(word) * m[0])
            val product = swap16(sum) * m[1]
            return (swap16(product) * m[2]) + product
        }

        private fun mixStep(start: UInt, list: UIntArray): UInt {
            var v = start
            for (k in list) v = swap16(v) * k
            return v
        }

        private fun readUInt32LE(buf: ByteArray, off: Int): UInt {
            val b0 = buf[off].toUInt() and 0xFFu
            val b1 = buf[off + 1].toUInt() and 0xFFu
            val b2 = buf[off + 2].toUInt() and 0xFFu
            val b3 = buf[off + 3].toUInt() and 0xFFu
            return b0 or (b1 shl 8) or (b2 shl 16) or (b3 shl 24)
        }

        private fun writeUInt32LE(buf: ByteArray, off: Int, v: UInt) {
            buf[off] = (v and 0xFFu).toByte()
            buf[off + 1] = ((v shr 8) and 0xFFu).toByte()
            buf[off + 2] = ((v shr 16) and 0xFFu).toByte()
            buf[off + 3] = ((v shr 24) and 0xFFu).toByte()
        }

        private fun toHexUpper(bytes: ByteArray): String {
            val sb = StringBuilder(bytes.size * 2)
            for (b in bytes) sb.append(String.format(Locale.US, "%02X", b))
            return sb.toString()
        }

        fun secMsGec(nowSec: Long = System.currentTimeMillis() / 1000L): String {
            var ticks = nowSec + 11644473600L
            ticks -= ticks % 300L
            val msgStr = COPY + (ticks * 10000000L).toString() + TRUSTED
            val msg = msgStr.toByteArray(Charsets.UTF_8)
            val digest = MessageDigest.getInstance("SHA-256").digest(msg)

            val k1 = readUInt32LE(digest, 0) or 1u
            val k2 = readUInt32LE(digest, 4) or 1u
            val padLen = ((msg.size + 7) / 8) * 8
            val padded = ByteArray(padLen)
            System.arraycopy(msg, 0, padded, 0, msg.size)

            var swapSum = 0u
            var lastSwap = 0u
            var mix = 0u
            var mixSum = 0u

            var o = 0
            while (o < padded.size) {
                val w1 = readUInt32LE(padded, o)
                val w2 = readUInt32LE(padded, o + 4)
                val first = swapTerm(w1, k1, SW1)
                lastSwap = swapTerm(w2, k2, SW2)
                swapSum += first + lastSwap
                mix = mixStep((mix + w1) * k1, MIX1)
                mixSum += mix
                mix = mixStep((mix + w2) * k2, MIX2)
                mixSum += mix
                o += 8
            }
            val out = ByteArray(8)
            writeUInt32LE(out, 0, lastSwap xor mix)
            writeUInt32LE(out, 4, swapSum xor mixSum)
            return "${toHexUpper(out)}-${toHexUpper(digest)}"
        }

        private fun xmlEscape(s: String): String =
            s.replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\"", "&quot;")
                .replace("'", "&apos;")

        private fun formatRate(rate: Double): String {
            val pct = (((rate - 1.0) * 100.0).toInt()).coerceIn(-50, 100)
            return if (pct >= 0) "+${pct}%" else "${pct}%"
        }

        private fun formatPitch(pitchHz: Int): String {
            val p = pitchHz.coerceIn(-30, 30)
            return if (p >= 0) "+${p}Hz" else "${p}Hz"
        }

        private fun utcTimestamp(): String {
            val fmt = SimpleDateFormat("EEE, dd MMM yyyy HH:mm:ss 'GMT'", Locale.US)
            fmt.timeZone = TimeZone.getTimeZone("GMT")
            return fmt.format(Date())
        }
    }

    private fun randomHex16(): String {
        val b = ByteArray(16)
        rng.nextBytes(b)
        return toHexUpper(b)
    }

    private fun sha256Key(input: String): String {
        val d = MessageDigest.getInstance("SHA-256").digest(input.toByteArray(Charsets.UTF_8))
        return toHexUpper(d).take(32)
    }

    fun isCached(text: String, voice: String, rate: Double, pitchHz: Int): Boolean {
        val clean = text.trim()
        if (clean.isEmpty()) return false
        val key = sha256Key("$voice|${formatRate(rate)}|${formatPitch(pitchHz)}|$clean")
        val targetFile = File(cacheDir, "$key.mp3")
        return targetFile.exists() && targetFile.length() > 256L
    }

    fun invalidateCache(text: String, voice: String, rate: Double, pitchHz: Int) {
        val clean = text.trim()
        if (clean.isEmpty()) return
        val key = sha256Key("$voice|${formatRate(rate)}|${formatPitch(pitchHz)}|$clean")
        runCatching { File(cacheDir, "$key.mp3").delete() }
    }

    /** 合成一段文本并原子写入本地缓存，返回 MP3 文件路径 */
    suspend fun synthesizeToFile(
        text: String,
        voice: String = "zh-CN-YunyangNeural",
        rate: Double = 1.0,
        pitchHz: Int = 0,
        azureKey: String = "",
        azureRegion: String = "eastasia",
        forceRefresh: Boolean = false,
    ): File = withContext(Dispatchers.IO) {
        val clean = text.trim()
        require(clean.isNotEmpty()) { "播报文本为空" }

        val rateStr = formatRate(rate)
        val pitchStr = formatPitch(pitchHz)
        val key = sha256Key("$voice|$rateStr|$pitchStr|$clean")
        val targetFile = File(cacheDir, "$key.mp3")

        if (forceRefresh) {
            runCatching { targetFile.delete() }
        } else if (targetFile.exists() && targetFile.length() > 256L) {
            targetFile.setLastModified(System.currentTimeMillis())
            return@withContext targetFile
        }

        // 同键并发合并：若后台预取正在合成该段，直接复用其结果，杜绝重复请求与并发写冲突
        val newDeferred = CompletableDeferred<File>()
        val existing = if (forceRefresh) null else inFlight.putIfAbsent(key, newDeferred)
        if (existing != null) {
            return@withContext existing.await()
        }

        try {
            val resultFile = netSemaphore.withPermit {
                if (!forceRefresh && targetFile.exists() && targetFile.length() > 256L) {
                    targetFile.setLastModified(System.currentTimeMillis())
                    return@withPermit targetFile
                }

                val mp3Bytes = if (azureKey.isNotBlank()) {
                    var lastErr: Throwable? = null
                    var data = ByteArray(0)
                    for (attempt in 0 until 2) {
                        try {
                            data = synthesizeAzureRest(
                                clean, voice, rateStr, pitchStr, azureKey.trim(), azureRegion.ifBlank { "eastasia" }
                            )
                            if (data.size > 256) break
                        } catch (e: Throwable) {
                            lastErr = e
                            if (attempt == 0) delay(350L)
                        }
                    }
                    if (data.size <= 256) throw (lastErr ?: RuntimeException("Azure TTS 返回空音频"))
                    data
                } else {
                    var lastErr: Throwable? = null
                    var data = ByteArray(0)
                    val backoffs = longArrayOf(350L, 950L)
                    for (attempt in 0 until 3) {
                        try {
                            data = synthesizeEdgeWs(clean, voice, rateStr, pitchStr)
                            if (data.size > 256) break
                            lastErr = RuntimeException("微软语音返回空音频")
                        } catch (e: Throwable) {
                            lastErr = e
                        }
                        if (attempt < backoffs.size) {
                            delay(backoffs[attempt])
                        }
                    }
                    if (data.size <= 256) throw (lastErr ?: RuntimeException("微软语音连接失败"))
                    data
                }

                val tmp = File(cacheDir, "$key.${UUID.randomUUID().toString().take(8)}.tmp")
                try {
                    tmp.writeBytes(mp3Bytes)
                    if (!tmp.renameTo(targetFile)) {
                        targetFile.writeBytes(mp3Bytes)
                        tmp.delete()
                    }
                } catch (e: Throwable) {
                    runCatching { tmp.delete() }
                    throw e
                }
                trimCacheIfNeeded()
                targetFile
            }
            newDeferred.complete(resultFile)
            resultFile
        } catch (e: Throwable) {
            newDeferred.completeExceptionally(e)
            throw e
        } finally {
            inFlight.remove(key, newDeferred)
        }
    }

    private fun synthesizeAzureRest(
        text: String,
        voice: String,
        rateStr: String,
        pitchStr: String,
        azureKey: String,
        region: String,
    ): ByteArray {
        val ssml = "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'>" +
            "<voice name='$voice'><prosody rate='$rateStr' pitch='$pitchStr'>${xmlEscape(text)}</prosody></voice></speak>"
        val req = Request.Builder()
            .url("https://$region.tts.speech.microsoft.com/cognitiveservices/v1")
            .header("Ocp-Apim-Subscription-Key", azureKey)
            .header("Content-Type", "application/ssml+xml")
            .header("X-Microsoft-OutputFormat", "audio-24khz-48kbitrate-mono-mp3")
            .header("User-Agent", "LumenPhilosophyReader/1.0")
            .post(ssml.toRequestBody("application/ssml+xml; charset=utf-8".toMediaType()))
            .build()

        client.newCall(req).execute().use { resp ->
            if (!resp.isSuccessful) throw RuntimeException("Azure TTS HTTP ${resp.code}")
            return resp.body?.bytes() ?: ByteArray(0)
        }
    }

    private suspend fun synthesizeEdgeWs(
        text: String,
        voice: String,
        rateStr: String,
        pitchStr: String,
    ): ByteArray = withTimeout(26_000L) {
        val connId = UUID.randomUUID().toString().replace("-", "")
        val gec = URLEncoder.encode(secMsGec(), "UTF-8")
        val url = "$WS_BASE?TrustedClientToken=$TRUSTED&Sec-MS-GEC=$gec&Sec-MS-GEC-Version=$GEC_VERSION&ConnectionId=$connId"

        val req = Request.Builder()
            .url(url)
            .header("Origin", "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold")
            .header("User-Agent", UA)
            .header("Pragma", "no-cache")
            .header("Cache-Control", "no-cache")
            .header("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
            .header("Cookie", "muid=${randomHex16()};")
            .build()

        val deferred = CompletableDeferred<ByteArray>()
        val audioOut = ByteArrayOutputStream()
        val marker = "Path:audio\r\n".toByteArray(Charsets.ISO_8859_1)

        val ws = client.newWebSocket(req, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                val stamp = utcTimestamp()
                val reqId = UUID.randomUUID().toString().replace("-", "")
                val config = "X-Timestamp:$stamp\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n" +
                    "{\"context\":{\"synthesis\":{\"audio\":{\"metadataoptions\":{\"sentenceBoundaryEnabled\":\"false\",\"wordBoundaryEnabled\":\"false\"},\"outputFormat\":\"audio-24khz-48kbitrate-mono-mp3\"}}}}"
                val ssml = "X-RequestId:$reqId\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:$stamp\r\nPath:ssml\r\n\r\n" +
                    "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'>" +
                    "<voice name='$voice'><prosody pitch='$pitchStr' rate='$rateStr' volume='+0%'>${xmlEscape(text)}</prosody></voice></speak>"
                webSocket.send(config)
                webSocket.send(ssml)
            }

            override fun onMessage(webSocket: WebSocket, textMsg: String) {
                if (textMsg.contains("Path:turn.end")) {
                    webSocket.close(1000, "done")
                    val bytes = synchronized(audioOut) { audioOut.toByteArray() }
                    if (!deferred.isCompleted) deferred.complete(bytes)
                }
            }

            override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                val arr = bytes.toByteArray()
                val idx = indexOfBytes(arr, marker)
                if (idx >= 0) {
                    val start = idx + marker.size
                    if (start < arr.size) {
                        synchronized(audioOut) {
                            audioOut.write(arr, start, arr.size - start)
                        }
                    }
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                if (!deferred.isCompleted) {
                    val bytes = synchronized(audioOut) { audioOut.toByteArray() }
                    if (bytes.size > 256) deferred.complete(bytes)
                    else deferred.completeExceptionally(t)
                }
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                if (!deferred.isCompleted) {
                    val bytes = synchronized(audioOut) { audioOut.toByteArray() }
                    if (bytes.size > 256) deferred.complete(bytes)
                    else deferred.completeExceptionally(RuntimeException("语音流提前关闭"))
                }
            }
        })

        try {
            deferred.await()
        } catch (e: Throwable) {
            ws.cancel()
            throw e
        }
    }

    private fun indexOfBytes(haystack: ByteArray, needle: ByteArray): Int {
        val limit = minOf(haystack.size, 320) - needle.size
        if (limit < 0) return -1
        for (i in 0..limit) {
            var match = true
            for (j in needle.indices) {
                if (haystack[i + j] != needle[j]) {
                    match = false
                    break
                }
            }
            if (match) return i
        }
        return -1
    }

    fun getCacheStatsJson(): String {
        val files = cacheDir.listFiles()?.filter { it.isFile && it.extension == "mp3" } ?: emptyList()
        val totalBytes = files.sumOf { it.length() }
        return """{"fileCount":${files.size},"totalBytes":$totalBytes}"""
    }

    fun clearCache(): Int {
        val files = cacheDir.listFiles() ?: return 0
        var count = 0
        for (f in files) {
            if (f.isFile && f.delete()) count++
        }
        return count
    }

    private fun trimCacheIfNeeded() {
        val files = cacheDir.listFiles()?.filter { it.extension == "mp3" } ?: return
        val total = files.sumOf { it.length() }
        if (total < 120L * 1024L * 1024L) return
        val sorted = files.sortedBy { it.lastModified() }
        var cur = total
        for (f in sorted) {
            if (cur < 80L * 1024L * 1024L) break
            cur -= f.length()
            f.delete()
        }
    }
}
