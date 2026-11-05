package app.codep.mobile

import org.junit.Assert.*
import org.junit.Test

class MarkdownBlocksTest {
    @Test
    fun parsesTheReportedFourColumnTableInsteadOfOneParagraph() {
        val blocks = parseMarkdownBlocks("""
            | 姓名 | 城市 | 年龄 | 爱好 |
            |---|---|---|---|
            | 小明 | 北京 | 25 | 阅读 |
            | 小红 | 上海 | 28 | 摄影 |
            | 小李 | 杭州 | 23 | 跑步 |
        """.trimIndent())
        val table = blocks.single() as MarkdownBlock.Table
        assertEquals(listOf("姓名", "城市", "年龄", "爱好"), table.headers)
        assertEquals(3, table.rows.size)
        assertEquals(listOf("小李", "杭州", "23", "跑步"), table.rows.last())
    }

    @Test
    fun preservesEscapedPipesAlignmentAndSurroundingContent() {
        val blocks = parseMarkdownBlocks("Intro\nName | Value | Note\n:--- | ---: | :---:\nA\\|B | 12 | **bold**\nShort | 3\n\nAfter")
        assertEquals(3, blocks.size)
        val table = blocks[1] as MarkdownBlock.Table
        assertEquals(listOf(TableAlignment.Left, TableAlignment.Right, TableAlignment.Center), table.alignments)
        assertEquals("A|B", table.rows[0][0])
        assertEquals("", table.rows[1][2])
        assertEquals(MarkdownBlock.Paragraph("After"), blocks[2])
        assertTrue(parseMarkdownBlocks("```text\nA | B\n--- | ---\n```").single() is MarkdownBlock.Code)
        assertTrue(parseMarkdownBlocks("A | B\ninvalid | ---").single() is MarkdownBlock.Paragraph)
    }
}
