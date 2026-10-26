<#
  Replace the named main icon group (IDR_MAINFRAME) of an exe with an icon built from a square PNG.
  rcedit --set-icon cannot do this for Chromium's exe because its icon groups have string names.

  Usage: powershell -File scripts\set-exe-icon.ps1 -Exe <path to exe copy> -Png <256px png>
#>
param(
  [Parameter(Mandatory = $true)][string]$Exe,
  [Parameter(Mandatory = $true)][string]$Png,
  [string]$Group = "IDR_MAINFRAME"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class ResUpd {
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] public static extern IntPtr BeginUpdateResource(string f, bool del);
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode, EntryPoint="UpdateResourceW")] public static extern bool UpdateResourceId(IntPtr h, IntPtr type, IntPtr name, ushort lang, byte[] data, uint cb);
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode, EntryPoint="UpdateResourceW")] public static extern bool UpdateResourceName(IntPtr h, IntPtr type, string name, ushort lang, byte[] data, uint cb);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool EndUpdateResource(IntPtr h, bool discard);
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] public static extern IntPtr LoadLibraryEx(string f, IntPtr h, uint flags);
  [DllImport("kernel32.dll")] public static extern bool FreeLibrary(IntPtr h);
  public delegate bool LangProc(IntPtr h, IntPtr type, IntPtr name, ushort lang, IntPtr p);
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] public static extern bool EnumResourceLanguages(IntPtr h, IntPtr type, string name, LangProc proc, IntPtr p);
  public static ushort FirstLanguage(string file, string group) {
    ushort result = 0; IntPtr h = LoadLibraryEx(file, IntPtr.Zero, 0x2);
    EnumResourceLanguages(h, (IntPtr)14, group, (hh, t, n, l, p) => { result = l; return false; }, IntPtr.Zero);
    FreeLibrary(h); return result;
  }
}
"@

function Get-ResizedBitmap([System.Drawing.Image]$src, [int]$size) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.DrawImage($src, 0, 0, $size, $size)
  $g.Dispose()
  return $bmp
}

# 32-bit DIB (BITMAPINFOHEADER + bottom-up BGRA + empty AND mask), the classic RT_ICON payload
function Get-DibBytes([System.Drawing.Bitmap]$bmp) {
  $w = $bmp.Width; $h = $bmp.Height
  $ms = New-Object System.IO.MemoryStream
  $bw = New-Object System.IO.BinaryWriter $ms
  $bw.Write([uint32]40); $bw.Write([int32]$w); $bw.Write([int32]($h * 2))
  $bw.Write([uint16]1); $bw.Write([uint16]32); $bw.Write([uint32]0)
  $bw.Write([uint32]($w * $h * 4)); $bw.Write([int32]0); $bw.Write([int32]0); $bw.Write([uint32]0); $bw.Write([uint32]0)
  $rect = New-Object System.Drawing.Rectangle 0, 0, $w, $h
  $data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $row = New-Object byte[] ($w * 4)
  for ($y = $h - 1; $y -ge 0; $y--) {
    [System.Runtime.InteropServices.Marshal]::Copy([IntPtr]($data.Scan0.ToInt64() + $y * $data.Stride), $row, 0, $w * 4)
    $bw.Write($row)
  }
  $bmp.UnlockBits($data)
  $maskRow = [int]([math]::Ceiling($w / 32.0) * 4)
  $bw.Write((New-Object byte[] ($maskRow * $h)))
  $bw.Flush()
  return $ms.ToArray()
}

function Get-PngBytes([System.Drawing.Bitmap]$bmp) {
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  return $ms.ToArray()
}

$Exe = (Resolve-Path $Exe).Path
$src = [System.Drawing.Image]::FromFile((Resolve-Path $Png).Path)
$lang = [ResUpd]::FirstLanguage($Exe, $Group)
Write-Host "group '$Group' language id: $lang"

$sizes = 16, 24, 32, 48, 64, 256
$images = @()
foreach ($s in $sizes) {
  $bmp = Get-ResizedBitmap $src $s
  $bytes = if ($s -ge 256) { Get-PngBytes $bmp } else { Get-DibBytes $bmp }
  $images += [pscustomobject]@{ Size = $s; Bytes = $bytes }
  $bmp.Dispose()
}
$src.Dispose()

$h = [ResUpd]::BeginUpdateResource($Exe, $false)
if ($h -eq [IntPtr]::Zero) { throw "BeginUpdateResource failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
try {
  $baseId = 9001
  $dir = New-Object System.IO.MemoryStream
  $dw = New-Object System.IO.BinaryWriter $dir
  $dw.Write([uint16]0); $dw.Write([uint16]1); $dw.Write([uint16]$images.Count)
  for ($i = 0; $i -lt $images.Count; $i++) {
    $img = $images[$i]
    $id = $baseId + $i
    if (-not [ResUpd]::UpdateResourceId($h, [IntPtr]3, [IntPtr]$id, $lang, $img.Bytes, [uint32]$img.Bytes.Length)) {
      throw "UpdateResource RT_ICON $id failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
    }
    $dim = if ($img.Size -ge 256) { 0 } else { $img.Size }
    $dw.Write([byte]$dim); $dw.Write([byte]$dim); $dw.Write([byte]0); $dw.Write([byte]0)
    $dw.Write([uint16]1); $dw.Write([uint16]32); $dw.Write([uint32]$img.Bytes.Length); $dw.Write([uint16]$id)
  }
  $dw.Flush()
  $groupBytes = $dir.ToArray()
  if (-not [ResUpd]::UpdateResourceName($h, [IntPtr]14, $Group, $lang, $groupBytes, [uint32]$groupBytes.Length)) {
    throw "UpdateResource RT_GROUP_ICON '$Group' failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
  }
  [void][ResUpd]::EndUpdateResource($h, $false)
} catch {
  [void][ResUpd]::EndUpdateResource($h, $true)
  throw
}
Write-Host "icon group '$Group' replaced in $Exe"
