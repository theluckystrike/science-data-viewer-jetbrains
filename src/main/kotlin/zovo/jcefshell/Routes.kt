package zovo.jcefshell

import java.io.File
import java.io.RandomAccessFile
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.security.SecureRandom
import java.util.Base64
import java.util.concurrent.ConcurrentHashMap

/** One open file. Only the editor that registered it knows the token. */
class ViewerEntry(
    val token: String,
    val file: File,
    val name: String,
    val kind: String,
    val bodyClass: () -> String,
    val themeCss: () -> String,
    val footerHtml: String,
    val host: HostActions,
)

/** What the page may ask the IDE to do. Every call comes from a user click in the viewer. */
interface HostActions {
    fun copy(text: String)
    /** Shows a save dialog; returns the chosen path or null when cancelled. */
    fun chooseSaveTarget(suggestedName: String, extensions: List<String>): File?
    fun openUrl(url: String)
}

class Response(val status: Int, val mime: String, val body: ByteArray, val headers: Map<String, String> = emptyMap()) {
    companion object {
        fun text(status: Int, s: String, mime: String = "text/plain; charset=utf-8") = Response(status, mime, s.toByteArray(StandardCharsets.UTF_8))
        fun json(status: Int, s: String) = text(status, s, "application/json; charset=utf-8")
    }
}

/** offset/length for a byte range, or null for HTTP 416. */
data class ByteRange(val offset: Long, val length: Int)

object Routes {
    const val ORIGIN = "http://zovo-science"
    const val MAX_RANGE = 64 * 1024 * 1024
    const val MAX_BODY = 400 * 1024 * 1024

    private val entries = ConcurrentHashMap<String, ViewerEntry>()
    private val random = SecureRandom()

    fun newToken(): String {
        val b = ByteArray(16); random.nextBytes(b)
        return b.joinToString("") { "%02x".format(it) }
    }

    fun register(e: ViewerEntry) { entries[e.token] = e }
    fun unregister(token: String) { entries.remove(token) }
    fun isRegistered(token: String) = entries.containsKey(token)
    fun openCount() = entries.size

    fun parseQuery(q: String?): Map<String, String> =
        (q ?: "").split('&').filter { it.contains('=') }.associate {
            val i = it.indexOf('=')
            URLDecoder.decode(it.substring(0, i), StandardCharsets.UTF_8) to URLDecoder.decode(it.substring(i + 1), StandardCharsets.UTF_8)
        }

    /** Checks offset and length against the file size. Missing values mean "the whole file" (small files only). */
    fun range(offsetText: String?, lengthText: String?, size: Long): ByteRange? {
        val offset = offsetText?.toLongOrNull() ?: if (offsetText == null) 0L else return null
        val length = lengthText?.toLongOrNull() ?: if (lengthText == null) size - offset else return null
        if (offset < 0 || length < 0 || offset > size || offset + length > size || length > MAX_RANGE) return null
        return ByteRange(offset, length.toInt())
    }

    fun readRange(file: File, r: ByteRange): ByteArray {
        val out = ByteArray(r.length)
        RandomAccessFile(file, "r").use { raf ->
            raf.seek(r.offset)
            raf.readFully(out)
        }
        return out
    }

    private fun mimeOf(name: String) = when (name.substringAfterLast('.', "")) {
        "js" -> "text/javascript; charset=utf-8"
        "css" -> "text/css; charset=utf-8"
        "html" -> "text/html; charset=utf-8"
        "wasm" -> "application/wasm"
        "svg" -> "image/svg+xml"
        "png" -> "image/png"
        else -> "application/octet-stream"
    }

    private val STATIC = Regex("^[A-Za-z0-9_-]+\\.(js|css|wasm|svg|png)$")

    fun esc(s: String) = s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;")

    private fun jsonString(s: String): String {
        val sb = StringBuilder("\"")
        for (c in s) when {
            c == '"' -> sb.append("\\\"")
            c == '\\' -> sb.append("\\\\")
            c == '<' -> sb.append("\\u003c")
            c < ' ' || c == ' ' || c == ' ' -> sb.append("\\u%04x".format(c.code))
            else -> sb.append(c)
        }
        return sb.append('"').toString()
    }

    fun page(e: ViewerEntry, template: String): String {
        val nonce = newToken()
        val config = "{\"token\":${jsonString(e.token)},\"name\":${jsonString(e.name)},\"size\":${e.file.length()},\"kind\":${jsonString(e.kind)}}"
        return template
            .replace("{{NONCE}}", nonce).replace("{{TOKEN}}", e.token).replace("{{KIND}}", e.kind)
            .replace("{{TITLE}}", esc(e.name)).replace("{{BODYCLASS}}", e.bodyClass())
            .replace("{{FOOTER}}", e.footerHtml).replace("{{CONFIG}}", config)
    }

    /** Minimal JSON field reader for the three POST bodies (flat objects of strings and string arrays). */
    fun jsonField(json: String, key: String): String? {
        val m = Regex("\"" + Regex.escape(key) + "\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"", RegexOption.DOT_MATCHES_ALL).find(json) ?: return null
        return unescape(m.groupValues[1])
    }

    fun jsonStringArray(json: String, key: String): List<String> {
        val m = Regex("\"" + Regex.escape(key) + "\"\\s*:\\s*\\[([^\\]]*)]").find(json) ?: return emptyList()
        return Regex("\"((?:[^\"\\\\]|\\\\.)*)\"").findAll(m.groupValues[1]).map { unescape(it.groupValues[1]) }.toList()
    }

    private fun unescape(s: String): String {
        if (!s.contains('\\')) return s
        val sb = StringBuilder(); var i = 0
        while (i < s.length) {
            val c = s[i]
            if (c != '\\' || i + 1 >= s.length) { sb.append(c); i++; continue }
            when (val n = s[i + 1]) {
                'n' -> sb.append('\n'); 't' -> sb.append('\t'); 'r' -> sb.append('\r'); 'b' -> sb.append('\b'); 'f' -> sb.append('\u000c')
                'u' -> { sb.append(s.substring(i + 2, minOf(s.length, i + 6)).toIntOrNull(16)?.toChar() ?: '?'); i += 4 }
                else -> sb.append(n)
            }
            i += 2
        }
        return sb.toString()
    }

    private val SAFE_NAME = Regex("[^A-Za-z0-9._-]+")
    private val ALLOWED_EXT = setOf("csv", "json", "png", "npy", "txt")

    /** Handles one request. resource(name) returns a bundled file from /web, or null. */
    fun handle(method: String, url: String, body: ByteArray?, resource: (String) -> ByteArray?): Response {
        if (!url.startsWith("$ORIGIN/")) return Response.text(404, "not found")
        val pathAndQuery = url.substring(ORIGIN.length)
        val path = pathAndQuery.substringBefore('?').substringBefore('#')
        val query = if (pathAndQuery.contains('?')) parseQuery(pathAndQuery.substringAfter('?').substringBefore('#')) else emptyMap()
        val parts = path.split('/').filter { it.isNotEmpty() }
        if (parts.size == 2 && parts[0] == "static" && method == "GET") {
            if (!STATIC.matches(parts[1])) return Response.text(404, "not found")
            val bytes = resource(parts[1]) ?: return Response.text(404, "not found")
            return Response(200, mimeOf(parts[1]), bytes, mapOf("Cache-Control" to "no-cache"))
        }
        if (parts.size != 3 || parts[0] != "t") return Response.text(404, "not found")
        val e = entries[parts[1]] ?: return Response.text(404, "This viewer is closed.")
        when (parts[2]) {
            "view.html" -> {
                val tpl = resource("view.html") ?: return Response.text(500, "missing template")
                return Response(200, "text/html; charset=utf-8", page(e, String(tpl, StandardCharsets.UTF_8)).toByteArray(StandardCharsets.UTF_8))
            }
            "theme.css" -> return Response.text(200, e.themeCss(), "text/css; charset=utf-8")
            "meta" -> return Response.json(200, "{\"size\":${e.file.length()},\"name\":${jsonString(e.name)}}")
            "file" -> {
                if (method != "GET") return Response.text(405, "GET only")
                val size = e.file.length()
                val r = range(query["offset"], query["length"], size)
                    ?: return Response(416, "text/plain", "Range not satisfiable".toByteArray(), mapOf("Content-Range" to "bytes */$size"))
                return Response(200, "application/octet-stream", readRange(e.file, r))
            }
        }
        if (method != "POST") return Response.text(405, "POST only")
        val text = String(body ?: ByteArray(0), StandardCharsets.UTF_8)
        if (text.length > MAX_BODY) return Response.json(413, "{\"error\":\"too large\"}")
        return when (parts[2]) {
            "copy" -> { e.host.copy(jsonField(text, "text") ?: ""); Response.json(200, "{\"ok\":true}") }
            "open" -> {
                val u = jsonField(text, "url") ?: ""
                if (!u.startsWith("https://")) return Response.json(400, "{\"error\":\"only https links\"}")
                e.host.openUrl(u); Response.json(200, "{\"ok\":true}")
            }
            "save" -> save(e, text)
            else -> Response.text(404, "not found")
        }
    }

    private fun save(e: ViewerEntry, text: String): Response {
        val kind = jsonField(text, "kind")
        val data = jsonField(text, "data") ?: return Response.json(400, "{\"error\":\"no data\"}")
        val exts = jsonStringArray(text, "filters").map { it.lowercase() }.filter { it in ALLOWED_EXT }.ifEmpty { listOf("csv") }
        val name = (jsonField(text, "name") ?: "export").substringAfterLast('/').substringAfterLast('\\').replace(SAFE_NAME, "_").take(120).ifBlank { "export" }
        val bytes = when (kind) {
            "text" -> data.toByteArray(StandardCharsets.UTF_8)
            "base64" -> try { Base64.getDecoder().decode(data) } catch (x: IllegalArgumentException) { return Response.json(400, "{\"error\":\"bad base64\"}") }
            else -> return Response.json(400, "{\"error\":\"bad kind\"}")
        }
        val target = e.host.chooseSaveTarget(name, exts) ?: return Response.json(200, "{\"cancelled\":true}")
        if (target.canonicalFile == e.file.canonicalFile) return Response.json(400, "{\"error\":\"Pick another file name. The viewer never writes over the file it shows.\"}")
        target.writeBytes(bytes)
        return Response.json(200, "{\"file\":${jsonString(target.absolutePath)},\"bytes\":${bytes.size}}")
    }
}
