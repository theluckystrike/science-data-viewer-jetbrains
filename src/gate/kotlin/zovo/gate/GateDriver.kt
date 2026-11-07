package zovo.gate

import com.intellij.ide.ui.LafManager
import com.intellij.notification.Notification
import com.intellij.notification.NotificationsManager
import com.intellij.openapi.wm.ToolWindowManager
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.startup.ProjectActivity
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.openapi.wm.WindowManager
import kotlinx.coroutines.delay
import zovo.jcefshell.Routes
import java.io.File

/** Real-IDE gate only (-Pgate=true, never published): runs commands from <gateDir>/cmd, one per line, and logs to <gateDir>/log. */
class GateDriver : ProjectActivity {
    override suspend fun execute(project: Project) {
        val dir = File(System.getProperty("zovo.gate.dir") ?: return).apply { mkdirs() }
        val cmd = File(dir, "cmd"); val log = File(dir, "log")
        fun say(s: String) = log.appendText("${System.currentTimeMillis()} $s\n")
        say("ready ${project.basePath}")
        var done = 0
        while (true) {
            delay(400)
            val lines = if (cmd.exists()) cmd.readLines().filter { it.isNotBlank() } else emptyList()
            while (done < lines.size) {
                val line = lines[done++]
                val arg = line.substringAfter(' ', "")
                try {
                    when (line.substringBefore(' ')) {
                        "open" -> ui { open(project, arg) }.also { say("opened $arg") }
                        "close" -> ui { FileEditorManager.getInstance(project).openFiles.forEach { FileEditorManager.getInstance(project).closeFile(it) } }.also { say("closed all, tokens=${Routes.openCount()}") }
                        "cycle" -> {
                            val (n, path) = arg.split(' ', limit = 2)
                            repeat(n.toInt()) { ui { open(project, path) }; delay(1500); ui { FileEditorManager.getInstance(project).openFiles.forEach { FileEditorManager.getInstance(project).closeFile(it) } }; delay(500) }
                            say("cycled $n $path tokens=${Routes.openCount()}")
                        }
                        "theme" -> ui {
                            val lm = LafManager.getInstance()
                            val want = lm.installedThemes.firstOrNull { it.name.equals(arg, true) } ?: lm.installedThemes.firstOrNull { it.name.contains(arg, true) }
                            if (want != null) { lm.setCurrentLookAndFeel(want, false); lm.updateUI() }
                            say("theme ${want?.name}")
                        }
                        "size" -> ui { WindowManager.getInstance().getFrame(project)?.let { val (w, h) = arg.split('x').map(String::toInt); it.setBounds(40, 40, w, h) } }.also { say("size $arg") }
                        "dismiss" -> ui { NotificationsManager.getNotificationsManager().getNotificationsOfType(Notification::class.java, project).forEach { it.expire() } }.also { say("dismissed") }
                        "project" -> ui { ToolWindowManager.getInstance(project).getToolWindow("Project")?.let { if (arg == "hide") it.hide() else it.show() } }.also { say("project $arg") }
                        "exit" -> { say("exit"); ui { ApplicationManager.getApplication().exit(true, true, false) } }
                        else -> say("unknown $line")
                    }
                } catch (t: Throwable) { say("error $line: $t") }
            }
        }
    }

    private suspend fun ui(f: () -> Unit) { ApplicationManager.getApplication().invokeAndWait(f) }

    private fun open(project: Project, path: String) {
        val vf = LocalFileSystem.getInstance().refreshAndFindFileByPath(path) ?: error("no file $path")
        FileEditorManager.getInstance(project).openFile(vf, true)
    }
}
