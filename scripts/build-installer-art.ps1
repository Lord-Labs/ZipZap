$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$zipzapRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$zipzapArt = Join-Path $zipzapRoot 'apps/desktop/src-tauri/installer'
$zipzapLogo = [Drawing.Image]::FromFile((Join-Path $zipzapRoot 'apps/desktop/src-tauri/icons/128x128.png'))
try {
  foreach ($zipzapName in @('sidebar', 'header')) {
    $zipzapSize = if ($zipzapName -eq 'sidebar') { @(164, 314) } else { @(150, 57) }
    $zipzapBitmap = [Drawing.Bitmap]::new($zipzapSize[0], $zipzapSize[1], [Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $zipzapGraphics = [Drawing.Graphics]::FromImage($zipzapBitmap)
    $zipzapFont = [Drawing.Font]::new('Segoe UI', 23, [Drawing.FontStyle]::Bold, [Drawing.GraphicsUnit]::Pixel)
    $zipzapWhite = [Drawing.SolidBrush]::new([Drawing.Color]::White)
    $zipzapMint = [Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#9edbc7'))
    $zipzapRail = [Drawing.Pen]::new([Drawing.ColorTranslator]::FromHtml('#307467'), 2)
    try {
      $zipzapGraphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
      $zipzapGraphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $zipzapGraphics.TextRenderingHint = [Drawing.Text.TextRenderingHint]::AntiAliasGridFit
      if ($zipzapName -eq 'sidebar') {
        $zipzapGradient = [Drawing.Drawing2D.LinearGradientBrush]::new(
          [Drawing.Point]::new(0, 0), [Drawing.Point]::new(164, 314),
          [Drawing.ColorTranslator]::FromHtml('#103b35'), [Drawing.ColorTranslator]::FromHtml('#087e71'))
        try { $zipzapGraphics.FillRectangle($zipzapGradient, 0, 0, 164, 314) } finally { $zipzapGradient.Dispose() }
        $zipzapGraphics.DrawImage($zipzapLogo, 42, 46, 80, 80)
        $zipzapGraphics.DrawString('ZipZap', $zipzapFont, $zipzapWhite, 39, 143)
        $zipzapGraphics.DrawLine($zipzapRail, 34, 238, 130, 238)
        foreach ($zipzapX in @(34, 82, 130)) { $zipzapGraphics.FillEllipse($zipzapMint, ($zipzapX - 4), 234, 8, 8) }
        $zipzapGraphics.FillRectangle($zipzapMint, 0, 308, 164, 6)
      } else {
        $zipzapGraphics.Clear([Drawing.Color]::White)
        $zipzapGraphics.DrawImage($zipzapLogo, 10, 12, 32, 32)
        $zipzapInk = [Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#103b35'))
        try { $zipzapGraphics.DrawString('ZipZap', $zipzapFont, $zipzapInk, 47, 14) } finally { $zipzapInk.Dispose() }
      }
      $zipzapBitmap.Save((Join-Path $zipzapArt "$zipzapName.bmp"), [Drawing.Imaging.ImageFormat]::Bmp)
    } finally {
      $zipzapRail.Dispose(); $zipzapMint.Dispose(); $zipzapWhite.Dispose()
      $zipzapFont.Dispose(); $zipzapGraphics.Dispose(); $zipzapBitmap.Dispose()
    }
  }
} finally { $zipzapLogo.Dispose() }
Write-Output 'Generated original ZipZap NSIS artwork (24-bit BMP).'
