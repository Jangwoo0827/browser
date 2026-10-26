# Shared helpers (dot-source me): Windows shell property store access for windows and .lnk files.
# Used to give Fjord's windows a taskbar identity (AppUserModelID, relaunch command/icon/name) and to stamp the
# same AppUserModelID onto the desktop shortcut so both group under one taskbar button.
if (-not ("ShellProps" -as [type])) {
  Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class ShellProps {
  [StructLayout(LayoutKind.Sequential, Pack = 4)] public struct PROPERTYKEY { public Guid fmtid; public uint pid; }
  [StructLayout(LayoutKind.Explicit)] public struct PROPVARIANT { [FieldOffset(0)] public ushort vt; [FieldOffset(8)] public IntPtr p; }

  [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IPropertyStore {
    [PreserveSig] int GetCount(out uint c);
    [PreserveSig] int GetAt(uint i, out PROPERTYKEY k);
    [PreserveSig] int GetValue(ref PROPERTYKEY k, out PROPVARIANT v);
    [PreserveSig] int SetValue(ref PROPERTYKEY k, ref PROPVARIANT v);
    [PreserveSig] int Commit();
  }
  [ComImport, Guid("0000010b-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IPersistFile {
    void GetClassID(out Guid id);
    [PreserveSig] int IsDirty();
    void Load([MarshalAs(UnmanagedType.LPWStr)] string file, uint mode);
    void Save([MarshalAs(UnmanagedType.LPWStr)] string file, [MarshalAs(UnmanagedType.Bool)] bool remember);
    void SaveCompleted([MarshalAs(UnmanagedType.LPWStr)] string file);
    void GetCurFile([MarshalAs(UnmanagedType.LPWStr)] out string file);
  }

  [DllImport("shell32.dll")] static extern int SHGetPropertyStoreForWindow(IntPtr hwnd, ref Guid riid, out IPropertyStore ps);
  [DllImport("ole32.dll")] static extern int PropVariantClear(ref PROPVARIANT v);
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);

  static readonly Guid AppUserModel = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3");
  static readonly Guid IID_IPropertyStore = new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99");
  public const uint PID_RelaunchCommand = 2, PID_RelaunchIcon = 3, PID_RelaunchName = 4, PID_AppId = 5;

  static void SetString(IPropertyStore ps, uint pid, string value) {
    var key = new PROPERTYKEY { fmtid = AppUserModel, pid = pid };
    var v = new PROPVARIANT { vt = 31, p = Marshal.StringToCoTaskMemUni(value) };   // VT_LPWSTR
    int hr = ps.SetValue(ref key, ref v);
    PropVariantClear(ref v);
    if (hr != 0) Marshal.ThrowExceptionForHR(hr);
  }
  static string GetString(IPropertyStore ps, uint pid) {
    var key = new PROPERTYKEY { fmtid = AppUserModel, pid = pid };
    PROPVARIANT v; ps.GetValue(ref key, out v);
    string s = (v.vt == 31 && v.p != IntPtr.Zero) ? Marshal.PtrToStringUni(v.p) : null;
    PropVariantClear(ref v);
    return s;
  }

  public static List<IntPtr> BrowserWindows(IEnumerable<uint> pids) {
    var set = new HashSet<uint>(pids);
    var list = new List<IntPtr>();
    EnumWindows((h, l) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (set.Contains(pid) && IsWindowVisible(h)) {
        var cls = new StringBuilder(256); GetClassName(h, cls, 256);
        if (cls.ToString().StartsWith("Chrome_WidgetWin")) list.Add(h);
      }
      return true;
    }, IntPtr.Zero);
    return list;
  }

  public static string WindowAppId(IntPtr hwnd) {
    var iid = IID_IPropertyStore; IPropertyStore ps;
    if (SHGetPropertyStoreForWindow(hwnd, ref iid, out ps) != 0 || ps == null) return null;
    return GetString(ps, PID_AppId);
  }

  // Returns true when properties were (re)written.
  public static bool SetWindowIdentity(IntPtr hwnd, string appId, string relaunchCommand, string iconResource, string displayName) {
    var iid = IID_IPropertyStore; IPropertyStore ps;
    if (SHGetPropertyStoreForWindow(hwnd, ref iid, out ps) != 0 || ps == null) return false;
    SetString(ps, PID_AppId, appId);
    SetString(ps, PID_RelaunchCommand, relaunchCommand);
    SetString(ps, PID_RelaunchIcon, iconResource);
    SetString(ps, PID_RelaunchName, displayName);
    int hr = ps.Commit();
    if (hr != 0) Marshal.ThrowExceptionForHR(hr);
    return true;
  }

  public static void SetLinkAppId(string lnkPath, string appId) {
    var link = Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("00021401-0000-0000-C000-000000000046")));
    var file = (IPersistFile)link;
    file.Load(lnkPath, 2);   // STGM_READWRITE
    var ps = (IPropertyStore)link;
    SetString(ps, PID_AppId, appId);
    int hr = ps.Commit();
    if (hr != 0) Marshal.ThrowExceptionForHR(hr);
    file.Save(lnkPath, true);
  }
}
"@
}
