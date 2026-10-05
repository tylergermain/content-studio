# Design canvas

Back to the [README](../README.md).

The **Canvas** tab is where you watch a designer work. It's the first tab of the Design board, the window a Designer opens with, and it shows in the Screening room and Reports too when a worker there makes a design. A design shows on it live, laid out like a design tool's page. You pin notes to its elements and send them back, export its artboards as PNGs, and an admin can bring a page of a Paper file in as a design.

## What a design is

A design is one HTML file whose name ends in `.design.html`, kept in the worker's folder (for a role, the floor's project). Each artboard is an element with `data-artboard="its name"` and a fixed size:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@900&display=swap">
  <style>
    .slide { width: 1080px; height: 1350px; position: relative; overflow: hidden; font-family: "Inter", sans-serif; }
  </style>
</head>
<body>
  <section class="slide" data-artboard="01 Cover">…</section>
  <section class="slide" data-artboard="02 Step one">…</section>
</body>
</html>
```

- **Placing artboards.** On the canvas the artboards sit side by side in a row. With `data-x` and `data-y` on every artboard (in pixels, as an import from Paper keeps them), each stands where those say instead.
- **No scripts.** It's HTML and CSS: the canvas serves a design sandboxed with scripts off, so nothing in it runs, even opened in a tab of its own.
- **Pictures.** They live beside it and are linked relatively. A `.assets` folder next to the design is the place: the chat's file lists skip it, so a design's raw pictures don't crowd the Board.
- **Fonts.** They come from Google Fonts or from font files beside the design. Pictures may also come from the web; nothing else loads.

## Watching it live

The canvas checks the design every second and a half, and shows a new save within a couple of seconds (**● Updated** and the time). It keeps where you were looking and what you'd picked.

- **Moving about.** Drag or scroll to move, pinch or ⌘/Ctrl-scroll to zoom. **0** fits everything, and **+** and **−** zoom.
- **On a phone.** One finger moves and two pinch. The 2D view at `/lite` opens the same window from a worker's card.
- **Choosing a design.** With more than one, the menu at the top left chooses. The newest one the worker linked shows first.

## Pinning notes

Click anything on an artboard (a headline, a picture, a drawing) and write what should change. It's pinned there with a number, and listed under the canvas. **Send notes** sends them all to the worker as one revision request. Each note names its artboard, what the element is ("text “Plan your next shoot”"), and the path to it (`[data-artboard="01 Cover"] > h1`), so the designer changes exactly that. The worker is asked to make the changes in the same file, so you watch them land on the canvas. Notes on a cut in the Screening room still ask for a new version file.

Only someone who may direct the worker (an admin, or its owner within their org-chart roles) can pin and send notes; anyone else sees the canvas read-only.

## Export

**Export PNGs** renders every artboard at its own size in a headless Chromium on the office's computer, with scripts off. Each is saved beside the design as `<design>-<artboard>.png`, overwriting the last export of the same artboard, and shows on the **Board** tab to compare, check at YouTube size and pick. Export needs `playwright-core` and its Chromium (`npx playwright install chromium`). `AGENT_OFFICE_CHROME` names another Chromium to use.

## Import from Paper

An admin's **Import from Paper** lists the files in your Paper team, the ones open in Paper Desktop first. Picking one brings across the page it's on as a design, in `outputs/designs/<name>/` in the worker's folder (`designs/<name>/` when it has no `outputs` folder). It takes:

- **Every artboard,** as Paper's own code for it (JSX with inline styles), turned into HTML, at its size and where it stood on Paper's page.
- **Its pictures,** copied from Paper into `.assets` beside the design, at full size.
- **Its fonts,** from Google Fonts at the weights it uses. Inter and the other families with an optical size axis come with it, so big type uses the same tighter display cut Paper draws.

The office talks to Paper through Paper's own agent connection, the `paper mcp` command Paper Desktop installs (`~/.paper/bin/paper`; `AGENT_OFFICE_PAPER` names another). So Paper Desktop needs to be installed and signed in on the office's computer. An import makes one call for the page and one per artboard, and each counts against your Paper plan's agent allowance. It never changes the Paper file, and each import goes in a new folder.

What Paper does that HTML doesn't come across as Paper draws it: a font that isn't on Google Fonts or the computer viewing it shows in a fallback, and an image Paper is still generating stays a link.
