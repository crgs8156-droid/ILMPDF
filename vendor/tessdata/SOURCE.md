# Tesseract English model

`eng.traineddata` is Tesseract's official "fast" English model, copied
unchanged. It is bundled into the OCR worker so the app never downloads it.

- Source: https://github.com/tesseract-ocr/tessdata_fast (file `eng.traineddata`)
- Repository commit: 87416418657359cb625c412a48b6e1d6d41c29bd (2024-08-01)
- Size: 4,113,088 bytes
- SHA-256: 7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2
- Licence: Apache-2.0 (Tesseract OCR project)

To check the file on your Mac: `shasum -a 256 vendor/tessdata/eng.traineddata`

Adding a language later means adding its `.traineddata` from the same
repository, recording it here, and bundling it in `src/workers/ocr.worker.ts`.
