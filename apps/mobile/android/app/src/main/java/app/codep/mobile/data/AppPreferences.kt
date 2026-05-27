package app.codep.mobile.data

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.first

private val Context.codepDataStore by preferencesDataStore(name = "codep_mobile")

const val DEFAULT_RELAY_ENDPOINT = "wss://codex-bridge.three.ink"

enum class AppThemeMode(val storageValue: String) {
    Dark("dark"),
    Light("light");

    companion object {
        fun fromStorage(value: String?): AppThemeMode {
            return values().firstOrNull { it.storageValue == value } ?: Dark
        }
    }
}

enum class AppLanguage(val storageValue: String) {
    English("en"),
    Chinese("zh");

    companion object {
        fun fromStorage(value: String?): AppLanguage {
            return values().firstOrNull { it.storageValue == value } ?: English
        }
    }
}

data class AppSettings(
    val relayEndpoint: String = DEFAULT_RELAY_ENDPOINT,
    val relayApiKey: String = "",
    val desktopDeviceId: String = "",
    val clientDeviceId: String = "",
    val lastEventId: Long = 0,
    val backgroundLastEventId: Long = 0,
    val notificationsEnabled: Boolean = true,
    val themeMode: AppThemeMode = AppThemeMode.Dark,
    val language: AppLanguage = AppLanguage.English
)

class AppPreferences(private val context: Context) {
    private object Keys {
        val relayEndpoint = stringPreferencesKey("relay_endpoint")
        val relayApiKey = stringPreferencesKey("relay_api_key")
        val desktopDeviceId = stringPreferencesKey("desktop_device_id")
        val clientDeviceId = stringPreferencesKey("client_device_id")
        val lastEventId = longPreferencesKey("last_event_id")
        val backgroundLastEventId = longPreferencesKey("background_last_event_id")
        val notificationsEnabled = booleanPreferencesKey("notifications_enabled")
        val themeMode = stringPreferencesKey("theme_mode")
        val language = stringPreferencesKey("language")
    }

    suspend fun read(): AppSettings {
        val prefs = context.codepDataStore.data.first()
        val clientDeviceId = prefs[Keys.clientDeviceId].orEmpty().ifBlank {
            "android-${System.currentTimeMillis().toString(36)}"
        }
        if (prefs[Keys.clientDeviceId].isNullOrBlank()) {
            context.codepDataStore.edit { it[Keys.clientDeviceId] = clientDeviceId }
        }
        val relayEndpoint = normalizeRelayEndpoint(
            prefs[Keys.relayEndpoint]
                ?.takeUnless(::isLegacyDefaultRelayEndpoint)
                ?: DEFAULT_RELAY_ENDPOINT
        )
        if (prefs[Keys.relayEndpoint] != relayEndpoint) {
            context.codepDataStore.edit { it[Keys.relayEndpoint] = relayEndpoint }
        }
        return AppSettings(
            relayEndpoint = relayEndpoint,
            relayApiKey = prefs[Keys.relayApiKey].orEmpty(),
            desktopDeviceId = prefs[Keys.desktopDeviceId].orEmpty(),
            clientDeviceId = clientDeviceId,
            lastEventId = prefs[Keys.lastEventId] ?: 0L,
            backgroundLastEventId = prefs[Keys.backgroundLastEventId] ?: (prefs[Keys.lastEventId] ?: 0L),
            notificationsEnabled = prefs[Keys.notificationsEnabled] ?: true,
            themeMode = AppThemeMode.fromStorage(prefs[Keys.themeMode]),
            language = AppLanguage.fromStorage(prefs[Keys.language])
        )
    }

    suspend fun saveRelayEndpoint(value: String) {
        context.codepDataStore.edit { it[Keys.relayEndpoint] = normalizeRelayEndpoint(value) }
    }

    suspend fun saveRelayApiKey(value: String) {
        context.codepDataStore.edit { it[Keys.relayApiKey] = value }
    }

    suspend fun saveDesktopDeviceId(value: String) {
        context.codepDataStore.edit { it[Keys.desktopDeviceId] = value }
    }

    suspend fun saveLastEventId(value: Long) {
        context.codepDataStore.edit { it[Keys.lastEventId] = value }
    }

    suspend fun saveBackgroundLastEventId(value: Long) {
        context.codepDataStore.edit { it[Keys.backgroundLastEventId] = value }
    }

    suspend fun saveNotificationsEnabled(value: Boolean) {
        context.codepDataStore.edit { it[Keys.notificationsEnabled] = value }
    }

    suspend fun saveThemeMode(value: AppThemeMode) {
        context.codepDataStore.edit { it[Keys.themeMode] = value.storageValue }
    }

    suspend fun saveLanguage(value: AppLanguage) {
        context.codepDataStore.edit { it[Keys.language] = value.storageValue }
    }
}

fun normalizeRelayEndpoint(value: String): String {
    return value.trim().trimEnd('/')
}

private fun isLegacyDefaultRelayEndpoint(value: String): Boolean {
    return normalizeRelayEndpoint(value).lowercase() in setOf(
        "ws://127.0.0.1:8909",
        "ws://localhost:8909",
        "ws://:8909",
        "wss://tx-bridge.three.ink",
        "https://tx-bridge.three.ink",
        "https://codex-bridge.three.ink"
    )
}
