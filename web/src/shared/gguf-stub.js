// The JetBrains plugin opens .npy and .npz only, so the GGUF reader is left out of the bundle.
module.exports = { gguf() { throw new Error('GGUF files are not supported in this version.'); } };
