' Starts launch.ps1 without a console window (used by the desktop shortcut). Extra arguments are passed through.
Set sh = CreateObject("WScript.Shell")
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
extra = ""
For Each a In WScript.Arguments
  extra = extra & " " & a
Next
sh.Run "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & dir & "\launch.ps1""" & extra, 0, False
