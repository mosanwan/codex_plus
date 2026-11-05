package app.codep.mobile

internal sealed class MarkdownBlock {
    data class Table(val headers: List<String>, val alignments: List<TableAlignment>, val rows: List<List<String>>) : MarkdownBlock()
    data class Heading(val level: Int, val text: String) : MarkdownBlock()
    data class Paragraph(val text: String) : MarkdownBlock()
    data class ListItems(val ordered: Boolean, val items: List<String>) : MarkdownBlock()
    data class Code(val language: String, val code: String) : MarkdownBlock()
    data class Quote(val text: String) : MarkdownBlock()
}

internal enum class TableAlignment { Left, Center, Right }

private fun tableCells(line: String): List<String> {
    var source = line.trim().removePrefix("|")
    if (source.endsWith("|") && !source.endsWith("\\|")) source = source.dropLast(1)
    val cells = mutableListOf<String>()
    val cell = StringBuilder()
    var index = 0
    while (index < source.length) {
        val char = source[index]
        if (char == '\\' && index + 1 < source.length && source[index + 1] in "\\|") {
            cell.append(source[index + 1])
            index += 2
            continue
        }
        if (char == '|') { cells += cell.toString().trim(); cell.clear() } else cell.append(char)
        index++
    }
    cells += cell.toString().trim()
    return cells
}

private fun tableHeader(lines: List<String>, index: Int): Pair<List<String>, List<TableAlignment>>? {
    if (index + 1 >= lines.size || !lines[index].contains('|')) return null
    val headers = tableCells(lines[index])
    val delimiters = tableCells(lines[index + 1])
    if (headers.size != delimiters.size || delimiters.any { !Regex("^:?-{3,}:?$").matches(it) }) return null
    return headers to delimiters.map {
        when { it.startsWith(':') && it.endsWith(':') -> TableAlignment.Center
            it.endsWith(':') -> TableAlignment.Right
            else -> TableAlignment.Left }
    }
}

internal fun parseMarkdownBlocks(text: String): List<MarkdownBlock> {
    val lines = text.replace("\r\n", "\n").lines()
    val blocks = mutableListOf<MarkdownBlock>()
    var index = 0
    while (index < lines.size) {
        val line = lines[index]
        if (line.isBlank()) {
            index += 1
            continue
        }
        if (line.trimStart().startsWith("```")) {
            val fence = line.trimStart()
            val language = fence.removePrefix("```").trim()
            val codeLines = mutableListOf<String>()
            index += 1
            while (index < lines.size && !lines[index].trimStart().startsWith("```")) {
                codeLines += lines[index]
                index += 1
            }
            if (index < lines.size) index += 1
            blocks += MarkdownBlock.Code(language = language, code = codeLines.joinToString("\n"))
            continue
        }
        val header = tableHeader(lines, index)
        if (header != null) {
            index += 2
            val rows = mutableListOf<List<String>>()
            while (index < lines.size && lines[index].isNotBlank() && lines[index].contains('|') && !startsMarkdownBlock(lines[index])) {
                val cells = tableCells(lines[index++])
                rows += List(header.first.size) { cells.getOrElse(it) { "" } }
            }
            blocks += MarkdownBlock.Table(header.first, header.second, rows)
            continue
        }
        val heading = Regex("""^(#{1,6})\s+(.+)$""").find(line)
        if (heading != null) {
            blocks += MarkdownBlock.Heading(
                level = heading.groupValues[1].length,
                text = heading.groupValues[2].trim()
            )
            index += 1
            continue
        }
        if (line.trimStart().startsWith(">")) {
            val quoteLines = mutableListOf<String>()
            while (index < lines.size && lines[index].trimStart().startsWith(">")) {
                quoteLines += lines[index].trimStart().removePrefix(">").trimStart()
                index += 1
            }
            blocks += MarkdownBlock.Quote(quoteLines.joinToString("\n"))
            continue
        }
        val unordered = Regex("""^\s*[-*]\s+(.+)$""")
        val ordered = Regex("""^\s*\d+\.\s+(.+)$""")
        val unorderedMatch = unordered.find(line)
        val orderedMatch = ordered.find(line)
        if (unorderedMatch != null || orderedMatch != null) {
            val isOrdered = orderedMatch != null
            val matcher = if (isOrdered) ordered else unordered
            val items = mutableListOf<String>()
            while (index < lines.size) {
                val match = matcher.find(lines[index]) ?: break
                items += match.groupValues[1].trim()
                index += 1
            }
            blocks += MarkdownBlock.ListItems(isOrdered, items)
            continue
        }
        val paragraphLines = mutableListOf(line.trim())
        index += 1
        while (index < lines.size && lines[index].isNotBlank() && !startsMarkdownBlock(lines[index]) && tableHeader(lines, index) == null) {
            paragraphLines += lines[index].trim()
            index += 1
        }
        blocks += MarkdownBlock.Paragraph(paragraphLines.joinToString(" "))
    }
    return blocks.ifEmpty { listOf(MarkdownBlock.Paragraph(text)) }
}

private fun startsMarkdownBlock(line: String): Boolean {
    val trimmed = line.trimStart()
    return trimmed.startsWith("```") ||
        Regex("""^#{1,6}\s+""").containsMatchIn(trimmed) ||
        trimmed.startsWith(">") ||
        Regex("""^[-*]\s+""").containsMatchIn(trimmed) ||
        Regex("""^\d+\.\s+""").containsMatchIn(trimmed)
}
