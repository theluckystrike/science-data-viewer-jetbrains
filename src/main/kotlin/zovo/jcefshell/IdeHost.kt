package zovo.jcefshell

import com.intellij.ide.BrowserUtil
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.fileChooser.FileChooserFactory
import com.intellij.openapi.fileChooser.FileSaverDescriptor
import com.intellij.openapi.ide.CopyPasteManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.LocalFileSystem
import java.awt.datatransfer.StringSelection
import java.io.File

/** HostActions for one editor: clipboard, the IDE save dialog next to the source file, and the system browser. */
class IdeHost(private val project: Project?, private val source: File) : HostActions {
    override fun copy(text: String) {
        ApplicationManager.getApplication().invokeLater { CopyPasteManager.getInstance().setContents(StringSelection(text)) }
    }

    override fun chooseSaveTarget(suggestedName: String, extensions: List<String>): File? {
        var result: File? = null
        ApplicationManager.getApplication().invokeAndWait({
            val descriptor = FileSaverDescriptor("Save From Viewer", "Choose where to save the file", extensions.firstOrNull() ?: "csv")
            val dir = source.parentFile?.let { LocalFileSystem.getInstance().findFileByIoFile(it) }
            result = FileChooserFactory.getInstance().createSaveFileDialog(descriptor, project).save(dir, suggestedName)?.file
        }, ModalityState.defaultModalityState())
        return result
    }

    override fun openUrl(url: String) = BrowserUtil.browse(url)
}
