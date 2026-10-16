param([Parameter(Mandatory=$true)][string]$Executable,[Parameter(Mandatory=$true)][string]$Icon)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class GPTIDEIcon {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr BeginUpdateResource(string path, bool delete);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool UpdateResource(IntPtr handle, IntPtr type, IntPtr name, ushort language, byte[] data, uint size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool EndUpdateResource(IntPtr handle, bool discard);
  public static void Write(string path, byte[] ico) {
    int count=BitConverter.ToUInt16(ico,4); byte[] group=new byte[6+14*count]; Array.Copy(ico,group,6);
    IntPtr handle=BeginUpdateResource(path,false); if(handle==IntPtr.Zero) throw new Win32Exception();
    bool done=false;
    try {
      for(int i=0;i<count;i++) {
        int offset=6+16*i, length=BitConverter.ToInt32(ico,offset+8), start=BitConverter.ToInt32(ico,offset+12);
        byte[] image=new byte[length]; Array.Copy(ico,start,image,0,length);
        if(!UpdateResource(handle,(IntPtr)3,(IntPtr)(i+1),1033,image,(uint)length)) throw new Win32Exception();
        Array.Copy(ico,offset,group,6+14*i,12); Array.Copy(BitConverter.GetBytes((ushort)(i+1)),0,group,18+14*i,2);
      }
      if(!UpdateResource(handle,(IntPtr)14,(IntPtr)1,1033,group,(uint)group.Length)) throw new Win32Exception();
      done=EndUpdateResource(handle,false); if(!done) throw new Win32Exception();
    } finally { if(!done) EndUpdateResource(handle,true); }
  }
}
'@
# Update a sibling copy first so a failed resource operation leaves the runtime intact.
$target = [System.IO.Path]::GetFullPath($Executable)
$temporary = $target + '.gptide-icon.tmp'
try {
  Copy-Item -LiteralPath $target -Destination $temporary -Force
  [GPTIDEIcon]::Write($temporary,[System.IO.File]::ReadAllBytes([System.IO.Path]::GetFullPath($Icon)))
  Copy-Item -LiteralPath $temporary -Destination $target -Force
} finally { if(Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force } }
