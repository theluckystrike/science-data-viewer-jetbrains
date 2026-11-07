package zovo.science;

import com.intellij.openapi.fileEditor.FileEditor;
import com.intellij.openapi.fileEditor.FileEditorPolicy;
import com.intellij.openapi.fileEditor.FileEditorProvider;
import com.intellij.openapi.project.DumbAware;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.vfs.VirtualFile;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;
import zovo.jcefshell.ShellEditor;

import java.util.Locale;
import java.util.Set;

/** Opens NetCDF, HDF5 and NumPy files in the read-only viewer instead of the "binary file" editor. */
public final class ScienceEditorProvider implements FileEditorProvider, DumbAware {
    public static final Set<String> NETCDF_HDF5 = Set.of("nc", "nc4", "cdf", "netcdf", "h5", "hdf5", "he5", "hdf");
    public static final Set<String> NUMPY = Set.of("npy", "npz");

    /** "netcdf", "tensor" or null. */
    public static @Nullable String kindOf(@Nullable String extension) {
        if (extension == null) return null;
        String ext = extension.toLowerCase(Locale.ROOT);
        if (NETCDF_HDF5.contains(ext)) return "netcdf";
        if (NUMPY.contains(ext)) return "tensor";
        return null;
    }

    @Override
    public boolean accept(@NotNull Project project, @NotNull VirtualFile file) {
        return !file.isDirectory() && kindOf(file.getExtension()) != null;
    }

    @Override
    public @NotNull FileEditor createEditor(@NotNull Project project, @NotNull VirtualFile file) {
        String kind = kindOf(file.getExtension());
        return new ShellEditor(project, file, kind == null ? "netcdf" : kind, "Viewer", Support.INSTANCE.footerHtml(), HeaderParser.INSTANCE::describe);
    }

    @Override public @NotNull String getEditorTypeId() { return "zovo-science-data-viewer"; }
    @Override public @NotNull FileEditorPolicy getPolicy() { return FileEditorPolicy.HIDE_DEFAULT_EDITOR; }
}
