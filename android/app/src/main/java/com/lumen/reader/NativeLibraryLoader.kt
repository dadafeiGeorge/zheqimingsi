package com.lumen.reader

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * 原生离线书库读取器：
 * 当手机息屏、Android 冻结 WebView JS 时，供 RadioForegroundService 直接从 assets/web/library/
 * 加载下一章正文并切分朗读段落，实现真正的息屏跨章不间断连播。
 */
object NativeLibraryLoader {

    data class LoadedChapter(
        val bookId: String,
        val bookTitle: String,
        val author: String,
        val chapterIndex: Int,
        val chapterCount: Int,
        val chapterTitle: String,
        val totalBlocks: Int,
        val segments: List<RadioForegroundService.Segment>,
    )

    private val FN_TAG_REGEX = Regex("⟦fn:\\d+⟧")
    private val HTML_TAG_REGEX = Regex("<[^>]+>")
    private val MD_IMG_REGEX = Regex("!\\[([^\\]]*)\\]\\([^)]+\\)")
    private val MD_LINK_REGEX = Regex("\\[([^\\]]+)\\]\\([^)]+\\)")
    private val FOOTNOTE_REF_REGEX = Regex("\\[\\^?\\d+\\]")
    private val MD_SYNTAX_REGEX = Regex("[*_`~#>]")
    private val PIPE_REGEX = Regex("\\|+")
    private val URL_REGEX = Regex("https?://\\S+")
    private val RULE_REGEX = Regex("[—\\-_=]{3,}")
    private val SPACE_REGEX = Regex("\\s+")
    private val TOC_DOTS_REGEX = Regex("[·…\\.]{4,}\\s*\\d+$")
    private val PURE_NUM_REGEX = Regex("^\\d+(\\.\\d+)*\\s*$")
    private val SENTENCE_SPLIT_REGEX = Regex("[^。！？；.!?;]+[。！？；.!?;]?")
    private val CLAUSE_SPLIT_REGEX = Regex("[^，,、：:]+[，,、：:]?")

    private fun cleanSpeakText(raw: String): String {
        var s = raw
        s = FN_TAG_REGEX.replace(s, "")
        s = HTML_TAG_REGEX.replace(s, "")
        s = MD_IMG_REGEX.replace(s, "")
        s = MD_LINK_REGEX.replace(s, "$1")
        s = FOOTNOTE_REF_REGEX.replace(s, "")
        s = MD_SYNTAX_REGEX.replace(s, "")
        s = PIPE_REGEX.replace(s, "，")
        s = URL_REGEX.replace(s, "")
        s = RULE_REGEX.replace(s, "")
        s = SPACE_REGEX.replace(s, " ")
        return s.trim()
    }

    private fun isTocLine(raw: String): Boolean {
        val s = raw.trim()
        if (s.isEmpty()) return true
        if (TOC_DOTS_REGEX.containsMatchIn(s)) return true
        if (PURE_NUM_REGEX.matches(s)) return true
        return false
    }

    private fun readAssetText(context: Context, assetPath: String): String? {
        return runCatching {
            context.assets.open(assetPath).bufferedReader(Charsets.UTF_8).use { it.readText() }
        }.getOrNull()
    }

    fun loadChapter(
        context: Context,
        bookId: String,
        chapterIndex: Int,
        announceChapter: Boolean,
    ): LoadedChapter? {
        if (bookId.isBlank() || bookId.startsWith("custom_")) return null
        val metaRaw = readAssetText(context, "web/library/books/$bookId/meta.json") ?: return null
        val meta = runCatching { JSONObject(metaRaw) }.getOrNull() ?: return null
        val chapters = meta.optJSONArray("chapters") ?: return null
        val chapterCount = chapters.length()
        if (chapterIndex < 0 || chapterIndex >= chapterCount) return null

        val chMeta = chapters.optJSONObject(chapterIndex) ?: return null
        val chunk = chMeta.optInt("chunk", 0)
        val chActualIndex = chMeta.optInt("index", chapterIndex)
        val bookTitle = meta.optString("title", "哲启明思")
        val author = meta.optString("author", "")

        val chunkRaw = readAssetText(context, "web/library/books/$bookId/p_$chunk.json") ?: return null
        val chunkObj = runCatching { JSONObject(chunkRaw) }.getOrNull() ?: return null
        val rawCh = chunkObj.optJSONObject(chActualIndex.toString()) ?: return null
        val chapterTitle = rawCh.optString("t", chMeta.optString("title", ""))
        val blocks: JSONArray = rawCh.optJSONArray("b") ?: JSONArray()

        val segs = ArrayList<RadioForegroundService.Segment>()
        if (announceChapter) {
            segs.add(
                RadioForegroundService.Segment(
                    blockIndex = 0,
                    text = "欢迎收听哲启明思电台。接下来为您播送《$bookTitle》，$chapterTitle。"
                )
            )
        }

        for (i in 0 until blocks.length()) {
            val b = blocks.optJSONObject(i) ?: continue
            val y = b.optString("y", "p")
            if (y == "r") continue
            val rawText = cleanSpeakText(b.optString("t", ""))
            if (rawText.length < 2 || isTocLine(rawText)) continue
            if (rawText.length <= 160) {
                segs.add(RadioForegroundService.Segment(i, rawText))
            } else {
                val pieces = SENTENCE_SPLIT_REGEX.findAll(rawText).map { it.value }.toList().ifEmpty { listOf(rawText) }
                val buf = StringBuilder()
                for (p in pieces) {
                    if (p.length > 160) {
                        if (buf.isNotEmpty()) {
                            segs.add(RadioForegroundService.Segment(i, buf.toString().trim()))
                            buf.clear()
                        }
                        val subPieces = CLAUSE_SPLIT_REGEX.findAll(p).map { it.value }.toList().ifEmpty { listOf(p) }
                        for (sp in subPieces) {
                            if (buf.length + sp.length > 150 && buf.isNotEmpty()) {
                                segs.add(RadioForegroundService.Segment(i, buf.toString().trim()))
                                buf.clear()
                                buf.append(sp)
                            } else {
                                buf.append(sp)
                            }
                        }
                    } else if (buf.length + p.length > 150 && buf.isNotEmpty()) {
                        segs.add(RadioForegroundService.Segment(i, buf.toString().trim()))
                        buf.clear()
                        buf.append(p)
                    } else {
                        buf.append(p)
                    }
                }
                if (buf.isNotBlank()) {
                    segs.add(RadioForegroundService.Segment(i, buf.toString().trim()))
                }
            }
        }

        return LoadedChapter(
            bookId = bookId,
            bookTitle = bookTitle,
            author = author,
            chapterIndex = chActualIndex,
            chapterCount = chapterCount,
            chapterTitle = chapterTitle,
            totalBlocks = blocks.length(),
            segments = segs,
        )
    }
}
