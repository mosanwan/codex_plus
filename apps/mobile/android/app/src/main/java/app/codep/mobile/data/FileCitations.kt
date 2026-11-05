package app.codep.mobile.data

import java.net.URLEncoder

internal fun renderFileCitations(text: String): String {
    val directive = Regex(""":{1,2}codex-file-citation\{((?:"(?:\\.|[^"\\])*"|[^"}])*)\}""")
    val pathField = Regex("""\bpath\s*=\s*"((?:\\.|[^"\\])*)"""")
    return directive.replace(text) { marker ->
        val raw = pathField.find(marker.groupValues[1])?.groupValues?.get(1) ?: return@replace marker.value
        val path = raw.replace(Regex("""\\(["\\/])"""), "$1")
        val name = path.substringAfterLast('/').substringAfterLast('\\')
        val href = URLEncoder.encode(path, Charsets.UTF_8.name()).replace("+", "%20")
        "[$name]($href)"
    }
}
