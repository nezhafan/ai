from setuptools import setup


APP = ["app.py"]
OPTIONS = {
    "argv_emulation": False,
    "includes": [
        "objc",
        "psutil",
        "AppKit",
        "Foundation",
    ],
    "excludes": [
        "distutils",
        "numpy",
        "PyInstaller",
        "pytest",
        "setuptools",
        "test",
        "tests",
        "tkinter",
        "unittest",
    ],
    "plist": {
        "CFBundleDisplayName": "Mac Monitor",
        "CFBundleExecutable": "Mac Monitor",
        "CFBundleIdentifier": "com.codex.mac-menu-bar-monitor",
        "CFBundleName": "Mac Monitor",
        "CFBundleShortVersionString": "0.1.0",
        "CFBundleVersion": "0.1.0",
        "LSUIElement": True,
        "NSHumanReadableCopyright": "Codex",
    },
    "packages": ["objc", "psutil", "AppKit", "Foundation"],
    "strip": True,
}


setup(
    app=APP,
    name="Mac Monitor",
    options={"py2app": OPTIONS},
    setup_requires=["py2app"],
)
