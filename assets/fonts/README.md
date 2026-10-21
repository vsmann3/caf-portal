# PDF fonts

Noto Sans and Noto Sans Devanagari, regular weights, from
https://github.com/notofonts/noto-fonts/tree/main/hinted/ttf
(retrieved 2026-10-21). Both are redistributed under the included SIL Open Font
License in `OFL.txt`. These files are bundled into the runtime image; generating
a CAF PDF does not contact a font service. Latin and Devanagari text are supported;
characters outside these fonts are represented by explicit Unicode code labels
rather than silently dropped or drawn as missing-glyph squares.
