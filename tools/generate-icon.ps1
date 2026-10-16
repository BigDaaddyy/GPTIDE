$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$assetRoot = Join-Path $PSScriptRoot '../assets'
$frames = @()
foreach ($size in @(16,32,48,64,128,256)) {
  $bitmap = [System.Drawing.Bitmap]::new($size,$size)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = 'AntiAlias'
  $graphics.ScaleTransform($size/256.0,$size/256.0)
  $brush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#252936'))
  $shape = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $shape.AddArc(8,8,104,104,180,90); $shape.AddArc(144,8,104,104,270,90)
  $shape.AddArc(144,144,104,104,0,90); $shape.AddArc(8,144,104,104,90,90); $shape.CloseFigure()
  $graphics.FillPath($brush,$shape)
  $pen = [System.Drawing.Pen]::new([System.Drawing.Color]::White,17)
  $pen.StartCap = 'Round'; $pen.EndCap = 'Round'; $pen.LineJoin = 'Round'
  $graphics.DrawLines($pen,[System.Drawing.PointF[]]@([System.Drawing.PointF]::new(94,77),[System.Drawing.PointF]::new(47,128),[System.Drawing.PointF]::new(94,179)))
  $graphics.DrawLines($pen,[System.Drawing.PointF[]]@([System.Drawing.PointF]::new(162,77),[System.Drawing.PointF]::new(209,128),[System.Drawing.PointF]::new(162,179)))
  $graphics.DrawLine($pen,145,87,111,169)
  $stream = [System.IO.MemoryStream]::new(); $bitmap.Save($stream,[System.Drawing.Imaging.ImageFormat]::Png)
  $frames += ,$stream.ToArray()
  if ($size -eq 256) { [System.IO.File]::WriteAllBytes((Join-Path $assetRoot 'icon.png'),$stream.ToArray()) }
  $stream.Dispose(); $pen.Dispose(); $shape.Dispose(); $brush.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
}
$output = [System.IO.MemoryStream]::new(); $writer = [System.IO.BinaryWriter]::new($output)
$writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$frames.Count)
$offset = 6 + 16*$frames.Count; $sizes = @(16,32,48,64,128,256)
for ($i=0; $i -lt $frames.Count; $i++) {
  $dimension = $sizes[$i] % 256
  $writer.Write([byte]$dimension); $writer.Write([byte]$dimension); $writer.Write([uint16]0)
  $writer.Write([uint16]1); $writer.Write([uint16]32); $writer.Write([uint32]$frames[$i].Length); $writer.Write([uint32]$offset)
  $offset += $frames[$i].Length
}
foreach ($frame in $frames) { $writer.Write([byte[]]$frame) }
[System.IO.File]::WriteAllBytes((Join-Path $assetRoot 'icon.ico'),$output.ToArray())
$writer.Dispose(); $output.Dispose()
