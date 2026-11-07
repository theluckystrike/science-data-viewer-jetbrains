package zovo.jcefshell

import com.intellij.ui.JBColor
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import java.awt.Color
import javax.swing.UIManager

/** IDE colours as the --vscode-* CSS variables the viewers use, so they follow the IDE theme. */
object ShellTheme {
    fun isDark() = !JBColor.isBright()
    fun bodyClass() = if (isDark()) "vscode-dark" else "vscode-light"

    private fun hex(c: Color?) = if (c == null) null else "#%02x%02x%02x".format(c.red, c.green, c.blue)
    private fun ui(key: String) = UIManager.getColor(key)
    private fun mix(a: Color, b: Color, t: Double) = Color((a.red + (b.red - a.red) * t).toInt(), (a.green + (b.green - a.green) * t).toInt(), (a.blue + (b.blue - a.blue) * t).toInt())

    fun css(): String {
        val dark = isDark()
        val bg = UIUtil.getPanelBackground()
        val editorBg = ui("EditorPane.background")?.takeIf { !dark } ?: (ui("Editor.background") ?: bg)
        val fg = UIUtil.getLabelForeground()
        val muted = UIUtil.getContextHelpForeground()
        val border = JBColor.border()
        val accent = JBUI.CurrentTheme.Focus.focusColor()
        val link = JBUI.CurrentTheme.Link.Foreground.ENABLED
        val sel = UIUtil.getListSelectionBackground(true)
        val selFg = UIUtil.getListSelectionForeground(true)
        val hover = mix(editorBg, sel, 0.35)
        val inputBg = ui("TextField.background") ?: editorBg
        val inputFg = ui("TextField.foreground") ?: fg
        val btn = ui("Button.default.startBackground") ?: accent
        val btnFg = ui("Button.default.foreground") ?: Color.WHITE
        val btn2 = ui("Button.startBackground") ?: mix(editorBg, fg, 0.12)
        val btn2Fg = ui("Button.foreground") ?: fg
        val err = JBColor.RED
        val font = UIUtil.getLabelFont()
        val vars = linkedMapOf(
            "editor-background" to hex(editorBg), "foreground" to hex(fg), "descriptionForeground" to hex(muted),
            "panel-border" to hex(border), "focusBorder" to hex(accent), "textLink-foreground" to hex(link),
            "list-hoverBackground" to hex(hover), "list-activeSelectionBackground" to hex(sel), "list-activeSelectionForeground" to hex(selFg),
            "input-background" to hex(inputBg), "input-foreground" to hex(inputFg), "input-border" to hex(border),
            "dropdown-background" to hex(inputBg), "dropdown-foreground" to hex(inputFg), "dropdown-border" to hex(border),
            "button-background" to hex(btn), "button-foreground" to hex(btnFg), "button-hoverBackground" to hex(mix(btn, fg, 0.1)),
            "button-secondaryBackground" to hex(btn2), "button-secondaryForeground" to hex(btn2Fg), "button-secondaryHoverBackground" to hex(mix(btn2, fg, 0.1)),
            "badge-background" to hex(accent), "badge-foreground" to "#ffffff", "charts-blue" to hex(link),
            "errorForeground" to hex(err), "symbolIcon-propertyForeground" to hex(link),
            "notifications-background" to hex(bg), "notifications-foreground" to hex(fg), "notifications-border" to hex(border),
            "editorHoverWidget-background" to hex(bg), "editorHoverWidget-foreground" to hex(fg), "editorHoverWidget-border" to hex(border),
            "inputValidation-warningBackground" to (if (dark) "#4a3d1a" else "#fff4d6"), "inputValidation-warningBorder" to (if (dark) "#a9822a" else "#d9a400"),
        )
        val sb = StringBuilder(":root{color-scheme:").append(if (dark) "dark" else "light").append(';')
        for ((k, v) in vars) if (v != null) sb.append("--vscode-").append(k).append(':').append(v).append(';')
        sb.append("--vscode-font-family:'").append(font.family.replace("'", "")).append("',-apple-system,'Segoe UI',sans-serif;")
        sb.append("--vscode-font-size:").append(font.size).append("px;")
        sb.append("--vscode-editor-font-family:'JetBrains Mono',Menlo,Consolas,monospace;}")
        return sb.toString()
    }
}
