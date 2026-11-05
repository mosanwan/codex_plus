package app.codep.mobile.data

import java.net.URI
import java.net.URLDecoder

internal fun normalizeArtifactPath(value: String): String =
    value.trim().replaceFirst(Regex("""^[/\\]+(?=[a-zA-Z]:[/\\])"""), "")

internal fun normalizePreviewHref(value: String): String {
    val trimmed = value.trim().removeSurrounding("<", ">").substringBefore('#').substringBefore('?')
    if (trimmed.isBlank()) return ""
    val raw = if (trimmed.startsWith("file://", ignoreCase = true)) {
        // rawPath keeps percent encoding for the single decode below.
        runCatching { URI(trimmed).rawPath.orEmpty() }.getOrDefault("")
    } else {
        if (Regex("""^[a-z][a-z0-9+.-]*:""", RegexOption.IGNORE_CASE).containsMatchIn(trimmed) &&
            !Regex("""^[a-zA-Z]:[\\/]""").containsMatchIn(trimmed)) return ""
        trimmed
    }
    val decoded = runCatching { URLDecoder.decode(raw.replace("+", "%2B"), Charsets.UTF_8.name()) }.getOrDefault(raw)
    return normalizeArtifactPath(decoded)
}
