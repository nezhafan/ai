# -*- mode: python ; coding: utf-8 -*-


from PyInstaller.utils.hooks import collect_submodules


hiddenimports = (
    collect_submodules("AppKit")
    + collect_submodules("Foundation")
    + collect_submodules("objc")
    + collect_submodules("psutil")
)

info_plist = {
    "CFBundleDisplayName": "Mac Monitor",
    "CFBundleIdentifier": "com.codex.mac-monitor",
    "CFBundleName": "Mac Monitor",
    "CFBundleShortVersionString": "0.1.0",
    "CFBundleVersion": "0.1.0",
    "LSUIElement": True,
}


a = Analysis(
    ["app.py"],
    pathex=[],
    binaries=[],
    datas=[],
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="Mac Monitor",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

app = BUNDLE(
    exe,
    name="Mac Monitor.app",
    icon="assets/app-icon.icns",
    bundle_identifier="com.codex.mac-monitor",
    info_plist=info_plist,
)
