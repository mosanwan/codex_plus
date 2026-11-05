package app.codep.mobile

import app.codep.mobile.data.Message

internal data class ChatMessageBlock(
    val id: String,
    val messages: List<Message>,
    val isActivity: Boolean
)

internal fun groupChatActivity(messages: List<Message>): List<ChatMessageBlock> {
    val blocks = mutableListOf<ChatMessageBlock>()
    var activity = mutableListOf<Message>()
    fun flushActivity() {
        if (activity.isEmpty()) return
        blocks += ChatMessageBlock(
            id = if (blocks.isEmpty()) "activity-leading" else "activity:${activity.first().id}",
            messages = activity.toList(),
            isActivity = true
        )
        activity = mutableListOf()
    }
    for (message in messages) {
        val meta = message.meta.trim().lowercase()
        val requiresAttention = meta == "error" || meta == "approval" ||
            meta.startsWith("approval.") || meta.endsWith(".failed") || meta.endsWith(".error")
        if (message.role == "event" && !requiresAttention) {
            activity += message
        } else {
            flushActivity()
            blocks += ChatMessageBlock("message:${message.id}", listOf(message), false)
        }
    }
    flushActivity()
    return blocks
}
