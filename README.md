# ElevenlabsWhisper

Simple audio recording using SoX in a Raycast view command.

- Saves recordings as WAV (16kHz/16-bit/mono)
- Default save location: `environment.supportPath/Recordings`
- Start/Stop manually, success toast on save

Requirements:
- macOS
- SoX installed and available on PATH (`brew install sox`)

Notes:
- The command uses the system default input device (if you plug in a headset and macOS switches the default input, the headset mic will be used).
- This extension currently records only; no transcription.
