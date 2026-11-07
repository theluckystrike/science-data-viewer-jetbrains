package zovo.science

import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder

/** Reads only the header of a NetCDF-3 or .npy file, for the plain view shown when JCEF is missing. */
object HeaderParser {
    private const val MAX_HEADER = 4 * 1024 * 1024

    fun describe(file: File): String = try {
        val head = readHead(file, MAX_HEADER)
        when {
            head.size >= 6 && head[0] == 0x93.toByte() && String(head, 1, 5, Charsets.US_ASCII) == "NUMPY" -> npy(head)
            head.size >= 4 && head[0] == 'C'.code.toByte() && head[1] == 'D'.code.toByte() && head[2] == 'F'.code.toByte() -> netcdf3(head)
            head.size >= 8 && head[1] == 'H'.code.toByte() && head[2] == 'D'.code.toByte() && head[3] == 'F'.code.toByte() -> "HDF5 / NetCDF-4 file. Groups and variables are shown in the full viewer, which needs JCEF."
            head.size >= 4 && head[0] == 'P'.code.toByte() && head[1] == 'K'.code.toByte() -> "NPZ archive (zip). The array list is shown in the full viewer, which needs JCEF."
            else -> "Unknown format (no NetCDF, HDF5 or NumPy signature in the first bytes)."
        }
    } catch (e: Exception) {
        "Could not read the header: " + (e.message ?: e.javaClass.simpleName)
    }

    private fun readHead(file: File, max: Int): ByteArray = RandomAccessFile(file, "r").use { raf ->
        val n = minOf(raf.length(), max.toLong()).toInt()
        ByteArray(n).also { raf.readFully(it) }
    }

    fun npy(b: ByteArray): String {
        val major = b[6].toInt()
        val bb = ByteBuffer.wrap(b).order(ByteOrder.LITTLE_ENDIAN)
        val (len, start) = if (major == 1) (bb.getShort(8).toInt() and 0xffff) to 10 else bb.getInt(8) to 12
        require(start + len <= b.size) { "header longer than the file" }
        val dict = String(b, start, len, Charsets.ISO_8859_1).trim()
        val descr = Regex("'descr'\\s*:\\s*'([^']*)'").find(dict)?.groupValues?.get(1) ?: "(structured)"
        val fortran = Regex("'fortran_order'\\s*:\\s*(True|False)").find(dict)?.groupValues?.get(1) ?: "?"
        val shape = Regex("'shape'\\s*:\\s*\\(([^)]*)\\)").find(dict)?.groupValues?.get(1)?.split(',')?.map { it.trim() }?.filter { it.isNotEmpty() } ?: emptyList()
        return "NumPy .npy version $major\ndtype: $descr\nshape: (${shape.joinToString(", ")}${if (shape.size == 1) "," else ""})\nfortran_order: $fortran"
    }

    private val NC_TYPES = mapOf(1 to ("byte" to 1), 2 to ("char" to 1), 3 to ("short" to 2), 4 to ("int" to 4), 5 to ("float" to 4), 6 to ("double" to 8))

    fun netcdf3(b: ByteArray): String {
        val version = b[3].toInt()
        if (version == 5) return "NetCDF-3 CDF-5 (64-bit data). Not supported yet."
        require(version == 1 || version == 2) { "unknown NetCDF version $version" }
        val bb = ByteBuffer.wrap(b).order(ByteOrder.BIG_ENDIAN)
        bb.position(4)
        val numrecs = bb.int
        fun name(): String { val n = bb.int; val s = String(b, bb.position(), n, Charsets.UTF_8); bb.position(bb.position() + ((n + 3) / 4) * 4); return s }
        fun skipAttrs() {
            val tag = bb.int; val n = bb.int
            if (tag == 0) return
            repeat(n) { name(); val t = NC_TYPES[bb.int]?.second ?: 1; val cnt = bb.int; bb.position(bb.position() + ((cnt * t + 3) / 4) * 4) }
        }
        val out = StringBuilder(if (version == 1) "NetCDF-3 classic" else "NetCDF-3 64-bit offset").append("\nrecords: ").append(numrecs).append("\n\nDimensions\n")
        val dims = ArrayList<Pair<String, Int>>()
        var tag = bb.int; var n = bb.int
        if (tag != 0) repeat(n) { val nm = name(); val len = bb.int; dims.add(nm to len); out.append("  ").append(nm).append(" = ").append(if (len == 0) "UNLIMITED ($numrecs)" else len.toString()).append('\n') }
        skipAttrs()
        out.append("\nVariables\n")
        tag = bb.int; n = bb.int
        if (tag != 0) repeat(n) {
            val nm = name()
            val nd = bb.int
            val ids = IntArray(nd) { bb.int }
            skipAttrs()
            val type = NC_TYPES[bb.int]?.first ?: "?"
            bb.int // vsize
            if (version == 1) bb.int else bb.long // begin
            out.append("  ").append(type).append(' ').append(nm).append('(').append(ids.joinToString(", ") { dims.getOrNull(it)?.first ?: "?" }).append(")\n")
        }
        return out.toString().trimEnd()
    }
}
