# Changelog

## 0.1.1 (2026-11-07)

- A truncated HDF5 or NetCDF-4 file (an interrupted copy or download) now says so, with the size its header expects and the size on disk. Before, the tree showed "error - name not defined!".
- Max shape shows unlimited dimensions as ∞ instead of 18446744073709552000.
- .npy and .npz error messages no longer tell you to use "Open as Raw Array..." in the Explorer, which only exists in the VS Code extension. They no longer use the VS Code product name.

## 0.1.0 (2026-11-07)

First release.
- NetCDF-3, NetCDF-4 and HDF5: tree, attributes, CF decoding, heatmap with dimension sliders, line plot, time series, stats, value table, CSV export.
- NumPy .npy and .npz: array list, stats, value table, heatmap, image view, save as .npy or CSV.
- Files are read by byte range through a private origin, never loaded whole.
- Header view without JCEF for NetCDF-3 and .npy.
