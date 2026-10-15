param([Parameter(Mandatory=$true)][string]$OutputPath)
$ErrorActionPreference = 'Stop'
# Use physical desktop pixels, including displays with negative origins and mixed DPI.
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class CaptureDpi {
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr value);
}
'@
[void][CaptureDpi]::SetProcessDpiAwarenessContext([IntPtr](-4))
if ([CaptureDpi]::SetThreadDpiAwarenessContext([IntPtr](-4)) -eq [IntPtr]::Zero) { throw 'Cannot enter physical pixel DPI mode. Use the system capture tool and import the image.' }
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$desktop = [System.Windows.Forms.SystemInformation]::VirtualScreen
if ([long]$desktop.Width * $desktop.Height -gt 64000000) { throw 'Desktop exceeds capture memory limit. Use the system capture tool and import a smaller image.' }
$bitmap = New-Object System.Drawing.Bitmap($desktop.Width, $desktop.Height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$form = $null
try {
  $graphics.CopyFromScreen($desktop.Left, $desktop.Top, 0, 0, $desktop.Size)
  $graphics.Dispose(); $graphics = $null
  $form = New-Object System.Windows.Forms.Form
  $form.FormBorderStyle = 'None'
  $form.StartPosition = 'Manual'
  $form.AutoScaleMode = 'None'
  $form.Bounds = $desktop
  $form.TopMost = $true
  $form.KeyPreview = $true
  $form.ShowInTaskbar = $false
  $form.Cursor = [System.Windows.Forms.Cursors]::Cross
  $form.BackgroundImage = $bitmap
  $form.BackgroundImageLayout = 'None'
  $form.Text = 'Markboxy region capture - Esc to cancel'
  $script:down = $false
  $script:selection = [System.Drawing.Rectangle]::Empty
  $script:start = [System.Drawing.Point]::Empty
  $form.Add_KeyDown({ if ($_.KeyCode -eq 'Escape') { $form.DialogResult = 'Cancel'; $form.Close() } })
  $form.Add_MouseDown({
    if ($_.Button -ne 'Left') { return }
    $script:start = $_.Location; $script:down = $true; $form.Capture = $true
  })
  $form.Add_MouseMove({
    if (!$script:down) { return }
    $x = [Math]::Max(0, [Math]::Min($desktop.Width, $_.X))
    $y = [Math]::Max(0, [Math]::Min($desktop.Height, $_.Y))
    $script:selection = New-Object System.Drawing.Rectangle([Math]::Min($script:start.X,$x), [Math]::Min($script:start.Y,$y), [Math]::Abs($x-$script:start.X), [Math]::Abs($y-$script:start.Y))
    $form.Invalidate()
  })
  $form.Add_MouseUp({
    if (!$script:down) { return }
    $script:down = $false; $form.Capture = $false
    if ($script:selection.Width -lt 1 -or $script:selection.Height -lt 1) { return }
    if ($script:selection.Width -gt 4096 -or $script:selection.Height -gt 4096) {
      [void][System.Windows.Forms.MessageBox]::Show($form, 'Please select a region no larger than 4096 x 4096 pixels.', 'Markboxy')
      return
    }
    $form.DialogResult = 'OK'; $form.Close()
  })
  $form.Add_Paint({
    $shade = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(110,0,0,0))
    try {
      $_.Graphics.FillRectangle($shade, 0, 0, $desktop.Width, $desktop.Height)
      if ($script:selection.Width -gt 0 -and $script:selection.Height -gt 0) {
        $_.Graphics.DrawImage($bitmap, $script:selection, $script:selection, [System.Drawing.GraphicsUnit]::Pixel)
        $_.Graphics.DrawRectangle([System.Drawing.Pens]::White, $script:selection)
      }
    } finally { $shade.Dispose() }
  })
  if ($form.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
    $result = $bitmap.Clone($script:selection, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try { $result.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png) } finally { $result.Dispose() }
  }
} finally {
  if ($graphics) { $graphics.Dispose() }
  if ($form) { $form.Dispose() }
  $bitmap.Dispose()
}
