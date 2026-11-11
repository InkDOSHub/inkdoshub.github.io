# Licenses and commercial use

Summary for anyone who wants to use InkDOS Hub, or parts of it, in a commercial project (for example, inside XeOS).
This is not legal advice. For a paid product, check with a lawyer, especially the GPL parts.

## Can be used commercially (keep the copyright notice and the license)

| Part | License | Notes |
|---|---|---|
| InkDOS Hub code (pages, Photos, Video and Music players, Photos editor, `inkfs` extension, `tools/linux/`) | MIT | `LICENSE` file at the root |
| Excalidraw (Whiteboard) | MIT | embedded fonts are OFL-1.1 or MIT, which also allow commercial use |
| VS Code for the web (Code) | MIT (VS Code code, "Code - OSS") | see "Caveats" about the name |
| mediainfo.js (video metadata) | BSD-2-Clause | |
| InkDOS apps (`inkdos/`) | MIT | bundled libraries have their licenses in `inkdos/licenses/`. The "Edit with ArtCraft" button opens the editors in `artcraft/` |
| v86 (terminal emulator) | BSD-2-Clause | |
| WebGL Aquarium (benchmark, `apps/xeos-tests/aquarium/`) | BSD-3-Clause (Google) | `apps/xeos-tests/aquarium/LICENSE.md` |
| MotionMark (benchmark, `apps/xeos-tests/motionmark/`) | BSD-2-Clause (Apple / WebKit) | license in each file |
| xterm.js | MIT | |

## Can be used, with extra obligations (copyleft)

| Part | License | What is required |
|---|---|---|
| Linux kernel 6.6 | GPL-2.0 | offer the corresponding source code. We use tag `v6.6` unmodified, plus `tools/linux/kernel-extra.config` and `tools/linux/build.sh`, so pointing to them is enough |
| Alpine programs inside the image (BusyBox, musl, apk-tools etc.) | GPL-2.0, MIT and others | same case: official Alpine 3.22 packages, unmodified, with public source code at Alpine |
| SeaBIOS / VGA BIOS | LGPL-3.0 | keep the license (`terminal/bios/COPYING.LESSER`) and say where the source code is |
| ArtCraft editors (`artcraft/`, pages in `apps/wordcraft`, `apps/gridcraft`, `apps/deckcraft`) | MIT or Apache-2.0 | downloaded from the web releases of github.com/storytold/{wordcraft,gridcraft,deckcraft} by the `artcraft.yml` action, unmodified; versions in `artcraft/versoes.txt` |
| jschardet (inside VS Code) | LGPL-2.1 | keep the license; the file is unmodified |
| ffmpeg.wasm 0.12.5 (`apps/video/cortar/ffmpeg-core/`) and 0.12.10 multithread (`apps/video/cortar/ffmpeg-core-mt/`), used for export | GPL-2.0 or later | offer the source code: they are the `@ffmpeg/core@0.12.5` and `@ffmpeg/core-mt@0.12.10` packages unmodified, with source at https://github.com/ffmpegwasm/ffmpeg.wasm |
| FFmpeg inside web-demuxer and ffprobe-wasm | LGPL-2.1 | keep the license and point to the source code (unmodified npm packages) |
| BentoPDF (`visualizadores/bentopdf/`) | AGPL-3.0 | keep the license and offer the source code (this repository is public) |

The GPL does not "contaminate" the rest of XeOS: Linux runs as a separate program inside the emulator, which counts as
aggregation, not a derivative work.

## Caveats

- **App Store:** if XeOS is an App Store app and starts *embedding* Linux (instead of opening
  https://inkdoshub.github.io/), the GPL parts may conflict with Apple's terms (as happened with VLC in 2011).
  Opening the page over the internet avoids this, because the app then does not distribute the code.
- **"VS Code" name:** "Visual Studio Code" and its logo are Microsoft trademarks. In a commercial product, call it
  "Code editor" (as the card already does) and do not use the logo. The configured extension store is Open VSX, which is
  allowed. The Microsoft store is not allowed outside Microsoft products.
- **Music:** the old player (Webamp, with the Winamp look) was replaced by an in-house player, so the "Winamp"
  trademark question no longer applies.

## Where the license texts are

- `apps/*/UPSTREAM-LICENSE.txt` and `apps/*/UPSTREAM-SOURCE.txt`
- `terminal/vendor/v86/LICENSE`, `terminal/vendor/xterm/LICENSE`, `terminal/bios/COPYING.LESSER`
- Kernel and Alpine: `tools/linux/` (how to rebuild and where each part comes from)
