# Echo

Capture ideas and record conversations on your phone or PC. Recordings are turned into text on your own PC, with who said what, and everything is stored in your own OneDrive.

**Open the app:** https://jacovanstraten-glitch.github.io/echo/

## What it does

- **New idea:** type it, dictate it, or record a voice note. Give it a status (New, Developing, Action, Parked, Done), a category and tags.
- **Record:** record a meeting or call. On the phone it keeps recording with the screen locked or in another app. Tap **Mark** at important moments and add a short note.
- **Transcribe on your PC:** the Echo transcriber turns each recording into text with Whisper and tells the speakers apart with pyannote. Both are free, open source and run offline. Give the speakers a name once and the whole transcript uses it.
- **Copy for Claude:** a ready prompt with the transcript, the speakers, your marked moments and instructions for that type of conversation (meeting, board meeting, partner or supplier call, team meeting, interview, phone call, talk, voice memo). Paste it in a Claude chat; paste the answer back.
- **Actions:** every `- [ ]` line in Claude's answer appears under Actions, across all recordings and ideas. Tick them off there.
- **Search** in titles, ideas, transcripts, Claude's answers and notes.
- **Import audio:** drop audio files on the PC window, or share a WhatsApp voice note or call recording to Echo on Android.

## Where your data lives

| What | Where |
| --- | --- |
| Ideas, transcripts, answers, settings | `OneDrive\Echo\index.json` |
| Audio | `OneDrive\Echo\Recordings\<date time title>.m4a` (or .webm, .ogg, …) |
| Transcript per recording | next to the audio: `<same name>.transcript.json` |
| Transcriber status | `OneDrive\Echo\transcriber.json` |
| Transcriber program and settings | `%LOCALAPPDATA%\Echo` on the PC |

The code in this repository contains no personal data and no secrets. The client ID in `config.js` is a public identifier (the same Microsoft app registration as Document Vault).

## On the PC

Double-click `pc/Echo.bat` (download it from Settings in the app). It opens Echo in its own window and starts the transcriber minimised next to it.

The first start installs the transcriber in `%LOCALAPPDATA%\Echo`: Python 3.12 if needed (via winget), Whisper, pyannote and the Whisper model (about 1.5 GB). That takes 5 to 15 minutes, once. It then asks for a Hugging Face token for speaker detection:

1. Make a free account on https://huggingface.co
2. Accept the conditions on https://huggingface.co/pyannote/speaker-diarization-community-1
3. Create a token (type *Read*) on https://huggingface.co/settings/tokens and paste it.

To change the token later, edit or delete `%LOCALAPPDATA%\Echo\config.json`. In the same file `model` can be set to `small` (faster, less accurate) or `large-v3` (slower, a little more accurate); the default is `large-v3-turbo`.

The transcriber only works while the PC is on and `Echo.bat` has been started. Recordings made in the meantime wait in OneDrive and are done as soon as it runs. With an NVIDIA graphics card it is used automatically and is much faster.

## Android app

`android/` holds a small Android app around the web app. It adds recording with the screen locked (a foreground service with a notification and a Stop button), Android's own dictation, "Add to Echo" in the share menu for audio, and long-press shortcuts on the icon (Record, Dictate idea, New idea). GitHub Actions builds and signs it on every change and publishes it as a release.

Install or update on the phone: https://github.com/jacovanstraten-glitch/echo/releases/latest/download/Echo.apk

The signing key `android/release.jks` is protected with a password that is stored as the repository secret `KS_PASSWORD`.

## Setup (once)

1. Microsoft Entra app registration (the Document Vault one): add `https://jacovanstraten-glitch.github.io/echo/` as an extra redirect URI under *Single-page application*.
2. GitHub: Settings › Pages › deploy from the `main` branch, root folder.
3. GitHub: Settings › Secrets and variables › Actions › add `KS_PASSWORD`.

## Libraries

Web: MSAL.js (Microsoft sign-in) and the fonts, served from this repository. PC: faster-whisper, pyannote.audio, PyTorch, installed from PyPI into a private environment.
