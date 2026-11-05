package app.codep.mobile

import app.codep.mobile.data.Message
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatMessageBlocksTest {
    @Test
    fun groupsExecutionWithoutHidingRepliesOrRequests() {
        val messages = listOf(
            Message("user", "user", "Please fix it"),
            Message("run", "event", "command", "Ran"),
            Message("output", "event", "output", "Output"),
            Message("commentary", "codex", "Working on the fix", "commentary"),
            Message("edit", "event", "patch", "Edited"),
            Message("error", "event", "Failure", "Error"),
            Message("approval", "event", "Please approve", "approval.requested"),
            Message("final", "codex", "Done", "final_answer")
        )
        val blocks = groupChatActivity(messages)
        assertEquals(messages, blocks.flatMap { it.messages })
        assertEquals(listOf("run", "output"), blocks[1].messages.map { it.id })
        assertTrue(blocks[1].isActivity)
        assertTrue(blocks[3].isActivity)
        listOf("user", "commentary", "error", "approval", "final").forEach { id ->
            assertFalse(blocks.single { block -> block.messages.any { it.id == id } }.isActivity)
        }
    }

    @Test
    fun leadingGroupKeepsIdentityWhenBufferMoves() {
        val messages = (0..50).map { Message("log-$it", "event", "Output $it", "Output") }
        assertEquals(groupChatActivity(messages.take(40)).first().id, groupChatActivity(messages.takeLast(40)).first().id)
        assertTrue(groupChatActivity(emptyList()).isEmpty())
    }
}
