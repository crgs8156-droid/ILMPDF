# ILMPDF

A private PDF toolkit for your Mac. Everything runs inside your browser, and
files never leave your computer: the app is technically blocked from using the network.

**Status:** Phase 1. Everyday page tools work offline:

- Merge PDFs, in the order you choose
- Split by page ranges or every N pages
- Organize pages with thumbnails: reorder, rotate, delete, extract
- Images (JPG, PNG, and other formats Safari can open, such as WebP) to PDF
- PDF to PNG or JPG images
- Add page numbers
- Add a text watermark
- View and remove metadata (author, title, dates)

Password-protected PDFs are refused for now; unlocking arrives in Phase 2.

## First run on your Mac

You need Node.js 22 or newer (`node -v` to check).

```sh
cd ~/Developer/ilmpdf
npm ci                 # installs exact pinned versions; install scripts are disabled
npm run build
npm run preview        # opens on http://127.0.0.1:4173
```

Open http://127.0.0.1:4173 in Safari. The header should show
**Network blocked** and **Cross-origin isolated** in green.
To add it to the Dock: Safari > File > Add to Dock.

## Development

```sh
npm run dev       # http://127.0.0.1:5173 with hot reload
npm run verify    # type check, unit tests, build, browser tests
```

### Test files

```sh
npm run make-test-pdfs
```

This writes 16 generated test files into `test-pdfs/`: PDFs with 1 to 300 pages,
mixed sizes, rotated pages, metadata, a password-protected file (password `test`),
a damaged file, an odd file name and a few PNG images. `test-pdfs/README.md` says
what each one is for. They are never committed. Use these instead of real documents.

Browser tests need Playwright's browsers once: `npx playwright install webkit chromium`.

See `CLAUDE.md` for the security rules and `docs/decisions/` for why things are the way they are.
