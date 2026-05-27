package app.codep.mobile

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import app.codep.mobile.data.AppThemeMode

internal data class CodepPalette(
    val primary: Color,
    val ink: Color,
    val body: Color,
    val muted: Color,
    val hairline: Color,
    val borderStrong: Color,
    val canvas: Color,
    val surfaceSoft: Color,
    val surfaceStrong: Color,
    val success: Color,
    val successBorder: Color,
    val successSoft: Color,
    val danger: Color,
    val dangerSoft: Color,
    val unread: Color,
    val focus: Color,
    val mustard: Color,
)

private val CodepDarkPalette = CodepPalette(
    primary = Color(0xFFF3F6FB),
    ink = Color(0xFFF3F6FB),
    body = Color(0xFFC9D1DC),
    muted = Color(0xFF8F9AA8),
    hairline = Color(0xFF2A3039),
    borderStrong = Color(0xFF586272),
    canvas = Color(0xFF111720),
    surfaceSoft = Color(0xFF171D27),
    surfaceStrong = Color(0xFF222A36),
    success = Color(0xFF76D985),
    successBorder = Color(0xFF318F42),
    successSoft = Color(0xFF102719),
    danger = Color(0xFFFF9F74),
    dangerSoft = Color(0xFF311912),
    unread = Color(0xFFFF3B30),
    focus = Color(0xFF8DB6FF),
    mustard = Color(0xFFD9A441),
)

private val CodepLightPalette = CodepPalette(
    primary = Color(0xFF181D26),
    ink = Color(0xFF181D26),
    body = Color(0xFF333840),
    muted = Color(0xFF6A707A),
    hairline = Color(0xFFDDDDDD),
    borderStrong = Color(0xFF9297A0),
    canvas = Color(0xFFFFFFFF),
    surfaceSoft = Color(0xFFF8FAFC),
    surfaceStrong = Color(0xFFE0E2E6),
    success = Color(0xFF006400),
    successBorder = Color(0xFF39BF45),
    successSoft = Color(0xFFEAF7ED),
    danger = Color(0xFFAA2D00),
    dangerSoft = Color(0xFFFFEEE7),
    unread = Color(0xFFFF3B30),
    focus = Color(0xFF254FAD),
    mustard = Color(0xFFD9A441),
)

internal val LocalCodepPalette = staticCompositionLocalOf { CodepDarkPalette }

private val CodepDarkScheme = darkColorScheme(
    primary = CodepDarkPalette.primary,
    onPrimary = CodepDarkPalette.canvas,
    secondary = CodepDarkPalette.body,
    onSecondary = CodepDarkPalette.canvas,
    background = CodepDarkPalette.canvas,
    onBackground = CodepDarkPalette.ink,
    surface = CodepDarkPalette.canvas,
    onSurface = CodepDarkPalette.ink,
    surfaceVariant = CodepDarkPalette.surfaceStrong,
    onSurfaceVariant = CodepDarkPalette.muted,
    outline = CodepDarkPalette.hairline,
    error = CodepDarkPalette.danger,
    onError = CodepDarkPalette.canvas,
    tertiary = CodepDarkPalette.success
)

private val CodepLightScheme = lightColorScheme(
    primary = CodepLightPalette.primary,
    onPrimary = CodepLightPalette.canvas,
    secondary = CodepLightPalette.body,
    onSecondary = CodepLightPalette.canvas,
    background = CodepLightPalette.canvas,
    onBackground = CodepLightPalette.ink,
    surface = CodepLightPalette.canvas,
    onSurface = CodepLightPalette.ink,
    surfaceVariant = CodepLightPalette.surfaceStrong,
    onSurfaceVariant = CodepLightPalette.muted,
    outline = CodepLightPalette.hairline,
    error = CodepLightPalette.danger,
    onError = CodepLightPalette.canvas,
    tertiary = CodepLightPalette.success
)

@Composable
fun CodepTheme(
    themeMode: AppThemeMode = AppThemeMode.Dark,
    content: @Composable () -> Unit
) {
    val palette = if (themeMode == AppThemeMode.Light) CodepLightPalette else CodepDarkPalette
    val scheme: ColorScheme = if (themeMode == AppThemeMode.Light) CodepLightScheme else CodepDarkScheme
    CompositionLocalProvider(LocalCodepPalette provides palette) {
        MaterialTheme(
            colorScheme = scheme,
            typography = MaterialTheme.typography,
            content = content
        )
    }
}
