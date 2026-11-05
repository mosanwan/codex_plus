package app.codep.mobile

import app.codep.mobile.data.RelayJson
import app.codep.mobile.data.snapshotFromPayload
import app.codep.mobile.data.renderFileCitations
import app.codep.mobile.data.normalizeArtifactPath
import app.codep.mobile.data.normalizePreviewHref
import org.junit.Assert.*
import org.junit.Test

class ArtifactReferenceTest {
    @Test
    fun slashPrefixedWindowsLinksRequestTheActualComputerPath() {
        val target = "C:/Workspace/ServoTest/outputs/sample-excel-20261106/测试文本.txt"
        for (href in listOf(target, "/$target", "/C:/Workspace/ServoTest/outputs/sample-excel-20261106/%E6%B5%8B%E8%AF%95%E6%96%87%E6%9C%AC.txt", "file:///$target")) {
            assertEquals(target, normalizePreviewHref(href))
        }
        assertEquals(target, normalizeArtifactPath("/$target"))
        assertEquals("C:/Work/a+b#c.txt", normalizePreviewHref("C:/Work/a%2Bb%23c.txt"))
        assertEquals("/home/user/file.txt", normalizePreviewHref("/home/user/file.txt"))
        assertEquals("", normalizePreviewHref("https://example.com/file.txt"))
    }
    @Test
    fun workbookCitationHasAClickableLoadLinkInsteadOfRawMarker() {
        val rendered = renderFileCitations(":codex-file-citation{path=\"C:/Workspace/示例销售记录.xlsx\" artifact_kind=\"workbook\" purpose=\"output\"}")
        assertTrue(rendered.startsWith("[示例销售记录.xlsx]("))
        assertFalse(rendered.contains("codex-file-citation"))
        assertTrue(rendered.contains("C%3A%2FWorkspace"))
    }
    @Test
    fun imageReferencesStayVisibleWithoutLoadingOriginalBytes() {
        val snapshot = snapshotFromPayload(RelayJson.parseToJsonElement("""
            {"messages":[{"id":"image-1","role":"artifact","text":"C:/generated/fox.png","meta":"image",
             "attachments":[{"id":"image-1","kind":"image","name":"fox.png","path":"C:/generated/fox.png","mimeType":"image/png"}]}]}
        """))!!
        val message = snapshot.messages!!.single()
        val reference = message.attachments.single()
        assertEquals("C:/generated/fox.png", reference.path)
        assertEquals("image/png", reference.mimeType)
        assertTrue(reference.dataUrl.isEmpty())
        assertFalse(groupChatActivity(listOf(message)).single().isActivity)
    }
}
