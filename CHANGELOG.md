# Changelog

## 0.1.0 (2026-11-07)

First release.
- NetCDF-3, NetCDF-4 and HDF5: tree, attributes, CF decoding, heatmap with dimension sliders, line plot, time series, stats, value table, CSV export.
- NumPy .npy and .npz: array list, stats, value table, heatmap, image view, save as .npy or CSV.
- Files are read by byte range through a private origin, never loaded whole.
- Header view without JCEF for NetCDF-3 and .npy.
