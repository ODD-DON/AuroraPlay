AuroraPlay — Branding and build notes

This repository has been minimally rebranded to `AuroraPlay` for a white-label build.

Changes made:
- Updated copilot instructions header to `AuroraPlay`.
- CI artifact names in `.appveyor.yml` updated to AuroraPlay.
- `.gitignore` now includes AuroraPlay entries.
- Added installer script: `scripts/auroraplay.iss`.
- Added placeholder asset: `assets/auroraplay-logo.svg`.

How to produce a Windows installer/exe locally

1. Build the project on Windows (MSYS2/Visual Studio) following project README.

Example (MSYS2 + Visual Studio 2019):

```bash
git submodule update --init --recursive
cmake -S . -B build -G "Ninja" -DCMAKE_BUILD_TYPE=Release
cmake --build build --target chiaki
```

2. Prepare a Windows build output folder named `AuroraPlay-Win` containing `AuroraPlay.exe` (or rename the built exe and supporting files into that folder).

3. Run Inno Setup (`ISCC`) to create the installer:

```powershell
ISCC.exe scripts\auroraplay.iss
```

Notes:
- I kept the original `SetupIconFile` pointing to `gui/chiaking.ico`. Replace it with your own `gui/auroraplay.ico` to update the installer icon.
- I did not change source code identifiers (types, function names) to avoid breaking builds; next steps can include deeper UI rewrites in `gui/` (QML) to achieve a full visual overhaul.

CI: one-click Windows build

I added a GitHub Actions workflow at `.github/workflows/windows-build.yml` that attempts to run the same Windows build script used by AppVeyor. To trigger a build (and get artifacts) you can:

- Push a commit to `main`/`master`, or
- Run the workflow manually from the GitHub Actions UI (Actions → Windows Build (AuroraPlay) → Run workflow).

After the workflow completes, download the `auroraplay-artifacts` artifact from the build run; it will contain `Chiaki` (the built exe + DLLs) and other outputs. Copy `Chiaki/*` into a folder `AuroraPlay-Win` and rename `chiaki.exe` → `AuroraPlay.exe`.

Local helper

I added `scripts/build-windows-locally.ps1` — run it from an elevated Developer x64 prompt to execute the same build script locally using MSYS2 bash.
