package zovo.science

import com.intellij.openapi.fileEditor.ex.FileEditorProviderManager
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.fileEditor.FileEditorPolicy
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import zovo.jcefshell.ShellEditor
import java.io.File

class ProviderAcceptTest : BasePlatformTestCase() {
    private val provider = ScienceEditorProvider()

    fun testAcceptsEachExtension() {
        for (ext in listOf("nc", "nc4", "cdf", "netcdf", "h5", "hdf5", "he5", "hdf", "NC", "H5")) {
            assertTrue(ext, provider.accept(project, myFixture.addFileToProject("a/x.$ext", "").virtualFile))
            assertEquals("netcdf", ScienceEditorProvider.kindOf(ext))
        }
        for (ext in listOf("npy", "npz", "NPY")) {
            assertTrue(ext, provider.accept(project, myFixture.addFileToProject("b/x.$ext", "").virtualFile))
            assertEquals("tensor", ScienceEditorProvider.kindOf(ext))
        }
        for (ext in listOf("txt", "csv", "json", "mat", "py", "ncl")) {
            assertFalse(ext, provider.accept(project, myFixture.addFileToProject("c/x.$ext", "").virtualFile))
        }
        assertEquals(FileEditorPolicy.HIDE_DEFAULT_EDITOR, provider.policy)
    }

    fun testOpensSampleNetcdfInTheViewer() {
        val sample = File(System.getProperty("science.samples"), "argo-profiles-classic.nc")
        val vf = LocalFileSystem.getInstance().refreshAndFindFileByIoFile(sample)!!
        assertTrue(provider.accept(project, vf))
        // The light test editor manager opens text editors only, so ask the provider registry and create the editor directly.
        val providers = FileEditorProviderManager.getInstance().getProviderList(project, vf)
        assertTrue(providers.map { it.javaClass.name }.toString(), providers.any { it is ScienceEditorProvider })
        assertEquals("Scientific Data", vf.fileType.name)
        val editor = provider.createEditor(project, vf)
        try {
            assertTrue(editor is ShellEditor)
            assertEquals(vf, editor.file)
            assertFalse(editor.isModified)
            assertTrue(editor.component.isEnabled)
        } finally {
            Disposer.dispose(editor)
        }
    }

    fun testHeaderFallbackForNetcdf3AndNpy() {
        val text = HeaderParser.describe(File(System.getProperty("science.samples"), "argo-profiles-classic.nc"))
        assertTrue(text, text.startsWith("NetCDF-3 64-bit offset"))
        assertTrue(text, text.contains("time = UNLIMITED (12)"))
        assertTrue(text, text.contains("float temp(time, depth)"))
        assertTrue(text, text.contains("char station(time, name_len)"))
        val npy = byteArrayOf(0x93.toByte()) + "NUMPY".toByteArray() + byteArrayOf(1, 0, 70, 0) +
            "{'descr': '<f4', 'fortran_order': False, 'shape': (512, 512), }".padEnd(69).plus("\n").toByteArray()
        val dir = File(System.getProperty("science.testTmp"), "npy-hdr").apply { mkdirs() }
        try {
            val f = File(dir, "a.npy").apply { writeBytes(npy + ByteArray(16)) }
            assertEquals("NumPy .npy version 1\ndtype: <f4\nshape: (512, 512)\nfortran_order: False", HeaderParser.describe(f))
        } finally { dir.deleteRecursively() }
        assertTrue(HeaderParser.describe(File(System.getProperty("science.samples"), "beamline-scan.h5")).startsWith("HDF5"))
    }
}
