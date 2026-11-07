package zovo.science

/** "Support and more tools" row (owner rule). PayPal is added only when factory/sprint/funding.json has it; it is empty now. */
object Support {
    const val REPO = "https://github.com/theluckystrike/science-data-viewer-jetbrains"
    val LINKS = listOf(
        "GitHub" to REPO,
        "Sponsor on GitHub" to "https://github.com/sponsors/theluckystrike",
        "NetCDF Viewer for VS Code" to "https://marketplace.visualstudio.com/items?itemName=zovo.hdf5-netcdf-explorer",
        "NumPy Viewer for VS Code" to "https://marketplace.visualstudio.com/items?itemName=zovo.tensor-viewer",
        "DOCX & PPTX Viewer for JetBrains" to "https://github.com/theluckystrike/office-viewer-jetbrains",
        "More Zovo tools" to "https://github.com/theluckystrike",
    )

    fun footerHtml(): String = LINKS.joinToString("<span class=\"sep\">·</span>", "<div class=\"zovo-support\">Support and more tools: ", "</div>") { (label, url) ->
        "<a href=\"" + url + "\">" + label.replace("&", "&amp;") + "</a>"
    }
}
