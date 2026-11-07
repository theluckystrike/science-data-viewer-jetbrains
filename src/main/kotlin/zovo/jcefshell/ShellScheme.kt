package zovo.jcefshell

import com.intellij.openapi.diagnostic.logger
import com.intellij.ui.jcef.JBCefApp
import com.intellij.util.concurrency.AppExecutorUtil
import org.cef.CefApp
import org.cef.handler.CefRequestHandler
import org.cef.handler.CefRequestHandlerAdapter
import org.cef.handler.CefResourceRequestHandler
import org.cef.handler.CefResourceRequestHandlerAdapter
import org.cef.misc.BoolRef
import org.cef.browser.CefBrowser
import org.cef.browser.CefFrame
import org.cef.callback.CefCallback
import org.cef.callback.CefSchemeHandlerFactory
import org.cef.handler.CefResourceHandler
import org.cef.handler.CefResourceHandlerAdapter
import org.cef.misc.IntRef
import org.cef.misc.StringRef
import org.cef.network.CefPostDataElement
import org.cef.network.CefRequest
import org.cef.network.CefResponse
import java.io.ByteArrayOutputStream
import java.util.Vector
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean

/**
 * The private origin http://zovo-science/. Registered once for the whole IDE, so requests from the page
 * and from its Web Worker both reach it. Files are reachable only through a registered token.
 */
object ShellScheme {
    private val LOG = logger<ShellScheme>()
    private val registered = AtomicBoolean(false)
    private val cache = ConcurrentHashMap<String, ByteArray>()

    fun ensureRegistered() {
        if (!registered.compareAndSet(false, true)) return
        JBCefApp.getInstance() // starts CEF if needed
        val ok = try { CefApp.getInstance().registerSchemeHandlerFactory("http", "zovo-science", Factory()) } catch (t: Throwable) { LOG.warn(t); false }
        if (!ok) LOG.info("Global zovo-science scheme handler not registered; using the per-browser request handler only")
    }

    /** Bundled files under /web in the plugin jar. */
    fun resource(name: String): ByteArray? = cache[name] ?: ShellScheme::class.java.getResourceAsStream("/web/$name")?.use { it.readBytes() }?.also { cache[name] = it }

    /** Per-browser route to the same handler, for the page itself (works also when the global factory is not available). */
    fun requestHandler(): CefRequestHandler = object : CefRequestHandlerAdapter() {
        override fun getResourceRequestHandler(browser: CefBrowser?, frame: CefFrame?, request: CefRequest?, isNavigation: Boolean, isDownload: Boolean,
                                               requestInitiator: String?, disableDefaultHandling: BoolRef?): CefResourceRequestHandler? {
            if (request?.url?.startsWith(Routes.ORIGIN + "/") != true) return null
            return object : CefResourceRequestHandlerAdapter() {
                override fun getResourceHandler(browser: CefBrowser?, frame: CefFrame?, request: CefRequest?): CefResourceHandler = Handler()
            }
        }
    }

    private class Factory : CefSchemeHandlerFactory {
        override fun create(browser: CefBrowser?, frame: CefFrame?, schemeName: String?, request: CefRequest?): CefResourceHandler = Handler()
    }

    private class Handler : CefResourceHandlerAdapter() {
        @Volatile private var response: Response? = null
        private var pos = 0

        override fun processRequest(request: CefRequest, callback: CefCallback): Boolean {
            val method = request.method ?: "GET"
            val url = request.url ?: ""
            val body = if (method == "POST") postBytes(request) else null
            AppExecutorUtil.getAppExecutorService().execute {
                response = try {
                    Routes.handle(method, url, body, ::resource)
                } catch (t: Throwable) {
                    LOG.warn("zovo-science request failed: " + url.substringBefore('?'), t)
                    Response.json(500, "{\"error\":\"" + (t.message ?: t.javaClass.simpleName).replace("\\", "/").replace("\"", "'") + "\"}")
                }
                callback.Continue()
            }
            return true
        }

        override fun getResponseHeaders(resp: CefResponse, responseLength: IntRef, redirectUrl: StringRef) {
            val r = response ?: Response.text(500, "no response")
            resp.status = r.status
            resp.statusText = when (r.status) { 200 -> "OK"; 404 -> "Not Found"; 416 -> "Range Not Satisfiable"; else -> "Status" }
            resp.mimeType = r.mime.substringBefore(';').trim()
            val headers = HashMap<String, String>(r.headers)
            headers["Content-Type"] = r.mime
            headers["X-Content-Type-Options"] = "nosniff"
            resp.setHeaderMap(headers)
            responseLength.set(r.body.size)
        }

        override fun readResponse(dataOut: ByteArray, bytesToRead: Int, bytesRead: IntRef, callback: CefCallback): Boolean {
            val body = response?.body ?: return false
            if (pos >= body.size) { bytesRead.set(0); return false }
            val n = minOf(bytesToRead, body.size - pos)
            System.arraycopy(body, pos, dataOut, 0, n)
            pos += n
            bytesRead.set(n)
            return true
        }

        override fun cancel() { response = null }
    }

    private fun postBytes(request: CefRequest): ByteArray? {
        val pd = request.postData ?: return null
        val elements = Vector<CefPostDataElement>()
        pd.getElements(elements)
        val out = ByteArrayOutputStream()
        for (e in elements) {
            val n = e.bytesCount
            if (n <= 0) continue
            val b = ByteArray(n)
            val got = e.getBytes(n, b)
            out.write(b, 0, got)
        }
        return out.toByteArray()
    }
}
