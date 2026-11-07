// Detects the file format from its first bytes. Never trusts the file extension alone.
const HDF5_SIG = [0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a];

const MAT = 'MATLAB 5.0 MAT-file';
const isMatV5 = head => head && head.length >= MAT.length && MAT.split('').every((ch, i) => head[i] === ch.charCodeAt(0));

/**
 * End-of-file address from an HDF5 superblock at offset 0 (versions 0-3), or null if it cannot be read.
 * A file shorter than this address was cut off (an interrupted copy or download).
 */
export function hdf5EofAddress(sb) {
  if (!sb || sb.length < 13 || !HDF5_SIG.every((b, i) => sb[i] === b)) return null;
  const ver = sb[8];
  let o, at;
  if (ver === 0 || ver === 1) { o = sb[13]; at = (ver === 0 ? 24 : 28) + 2 * o; }
  else if (ver === 2 || ver === 3) { o = sb[9]; at = 12 + 2 * o; }
  else return null;
  if (!(o === 4 || o === 8) || sb.length < at + o) return null;
  let v = 0, allFF = true;
  for (let i = o - 1; i >= 0; i--) { v = v * 256 + sb[at + i]; if (sb[at + i] !== 0xff) allFF = false; }
  return allFF ? null : v;
}

/** head: Uint8Array of the first bytes. sigAt: optional reader for HDF5 user-block offsets. */
export function detectFormat(head, sigAt, fileSize) {
  if (head.length >= 4 && head[0] === 0x43 && head[1] === 0x44 && head[2] === 0x46) {
    if (head[3] === 1) return { format: 'netcdf3', label: 'NetCDF-3 classic' };
    if (head[3] === 2) return { format: 'netcdf3', label: 'NetCDF-3 64-bit offset' };
    if (head[3] === 5) return { format: 'unsupported', label: 'NetCDF-3 CDF-5 (64-bit data)', reason: 'CDF-5 files are not supported yet. Convert with: nccopy -k nc4 in.nc out.nc' };
  }
  const isH5 = buf => buf && buf.length >= 8 && HDF5_SIG.every((b, i) => buf[i] === b);
  if (isH5(head)) {
    const eof = hdf5EofAddress(head);
    if (fileSize != null && eof != null && eof > fileSize) {
      return { format: 'unsupported', label: 'HDF5 (truncated)', reason: `This file is truncated: its header says it is ${eof.toLocaleString('en-US')} bytes, but only ${fileSize.toLocaleString('en-US')} bytes are there. The copy or download was probably interrupted. Get the file again.` };
    }
    return { format: 'hdf5', label: 'HDF5' };
  }
  if (sigAt) for (let off = 512; off <= 1 << 30; off *= 2) {
    const b = sigAt(off);
    if (!b) break;
    if (isH5(b)) return { format: 'hdf5', label: 'HDF5 (user block)' };
  }
  if (isMatV5(head)) return { format: 'unsupported', label: 'MATLAB v5 MAT-file', reason: 'This is a MATLAB MAT-file in the older v5 format, which is not HDF5. In MATLAB, save it again with save(filename, \'-v7.3\') and open that file here.' };
  if (head.length >= 4 && head[0] === 0xcd && head[1] === 0xf3 && head[2] === 0x00 && head[3] === 0x01) return { format: 'unsupported', label: 'NASA CDF', reason: 'This is a NASA CDF file, not NetCDF. It is not supported.' };
  if (head.length >= 4 && head[0] === 0x0e && head[1] === 0x03 && head[2] === 0x13 && head[3] === 0x01) return { format: 'unsupported', label: 'HDF4', reason: 'This is an HDF4 file. Only HDF5 and NetCDF are supported.' };
  return { format: 'unknown', label: 'unknown', reason: 'This file is not HDF5 or NetCDF (no known signature in the first bytes).' };
}
