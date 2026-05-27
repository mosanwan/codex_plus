package app.codep.mobile

import android.Manifest
import android.content.Intent
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.core.view.WindowInsetsControllerCompat
import app.codep.mobile.data.AppThemeMode

class MainActivity : ComponentActivity() {
    private val viewModel: MobileViewModel by viewModels()
    private val notificationPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = Color.rgb(17, 23, 32)
        window.navigationBarColor = Color.rgb(17, 23, 32)
        WindowInsetsControllerCompat(window, window.decorView).apply {
            isAppearanceLightStatusBars = false
            isAppearanceLightNavigationBars = false
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
        setContent {
            val state by viewModel.state.collectAsState()
            val lightMode = state.themeMode == AppThemeMode.Light
            SideEffect {
                window.statusBarColor = if (lightMode) {
                    Color.rgb(255, 255, 255)
                } else {
                    Color.rgb(17, 23, 32)
                }
                window.navigationBarColor = if (lightMode) {
                    Color.rgb(255, 255, 255)
                } else {
                    Color.rgb(17, 23, 32)
                }
                WindowInsetsControllerCompat(window, window.decorView).apply {
                    isAppearanceLightStatusBars = lightMode
                    isAppearanceLightNavigationBars = lightMode
                }
            }
            CodepTheme(themeMode = state.themeMode) {
                CodepMobileApp(viewModel = viewModel)
            }
        }
        handleLaunchIntent(intent)
    }

    override fun onStart() {
        super.onStart()
        AppVisibility.foreground = true
        RelayBackgroundService.stop(applicationContext)
        viewModel.connectRelay()
    }

    override fun onStop() {
        AppVisibility.foreground = false
        viewModel.disconnectRelay()
        RelayBackgroundService.start(applicationContext)
        super.onStop()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleLaunchIntent(intent)
    }

    private fun handleLaunchIntent(intent: Intent?) {
        if (intent?.action != ACTION_OPEN_SESSION) return
        viewModel.openSessionFromNotification(
            sessionId = intent.getStringExtra(EXTRA_SESSION_ID).orEmpty(),
            workspace = intent.getStringExtra(EXTRA_WORKSPACE_ID).orEmpty()
        )
    }

    companion object {
        const val ACTION_OPEN_SESSION = "app.codep.mobile.action.OPEN_SESSION"
        const val EXTRA_SESSION_ID = "app.codep.mobile.extra.SESSION_ID"
        const val EXTRA_WORKSPACE_ID = "app.codep.mobile.extra.WORKSPACE_ID"
        const val EXTRA_EVENT_ID = "app.codep.mobile.extra.EVENT_ID"
    }
}
