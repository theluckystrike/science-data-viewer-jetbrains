package zovo.science;

import com.intellij.icons.AllIcons;
import com.intellij.openapi.fileTypes.FileType;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import javax.swing.*;

/** Binary file types so the IDE does not ask what to do with .nc, .h5 or .npy files. */
public final class ScienceFileType implements FileType {
    public static final ScienceFileType SCIENTIFIC = new ScienceFileType("Scientific Data", "NetCDF or HDF5 file");
    public static final ScienceFileType NUMPY = new ScienceFileType("NumPy Array", "NumPy .npy or .npz file");

    private final String name;
    private final String description;

    private ScienceFileType(String name, String description) { this.name = name; this.description = description; }

    @Override public @NotNull String getName() { return name; }
    @Override public @NotNull String getDescription() { return description; }
    @Override public @NotNull String getDefaultExtension() { return this == NUMPY ? "npy" : "nc"; }
    @Override public @Nullable Icon getIcon() { return AllIcons.FileTypes.Any_type; }
    @Override public boolean isBinary() { return true; }
}
