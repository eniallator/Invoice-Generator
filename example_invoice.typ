// Typst Simple Invoice Template
// Based on the LaTeX Simple Invoice Template by Amy Fare | amyfare.ca
// Source: amyfare.ca/files/simple_invoice_template.tex
// License: Creative Commons Attribution (CC BY 4.0)
// Feel free to distribute, modify, and use as you wish, but please keep this line and the 4 lines above unchanged.

#set page(paper: "us-letter", margin: 1in) // Document margins
#set text(font: "New Computer Modern", size: 10pt)
#set par(leading: 0.52em, spacing: 1.2em)

// The tables' rows are 1.5 times the height of a line, with striped rows
#let striped(..args) = table(
  stroke: none,
  inset: (x: 6pt, y: 5.6pt),
  fill: (_, y) => if calc.odd(y) { luma(236) },
  ..args,
)
// The heading row has a bit more space below it, for the line under it
#let head(body) = table.cell(inset: (x: 6pt, top: 5.6pt, bottom: 9.9pt), strong(body))

// The total is a fixed distance wide, so the word Total always sits the same distance from the right edge
#let total(amount) = align(right, box(
  width: 4.5cm,
  inset: (bottom: 6pt),
  stroke: (bottom: 0.4pt),
  text(size: 12pt)[*Total* #h(1fr) #amount],
))

// Header, for company, invoice info
#pad(top: 3pt, right: 6pt, align(right)[*Foo Bar* \ 1 Baz\ Qux\ Quux \ Email: foo\@bar.baz\ Mobile: +01 2345 678910])

#v(4pt)

#align(center)[#text(size: 14.4pt)[*INVOICE*] \ *Purchase Order: ABC123*]

#v(2pt)

#grid(
  columns: (1fr, auto),
  [#underline[Invoice To:] \ 1 Makebelieve Avenue,\ Sim City\ America \ Attention: John Doe \ Email: johndoe\@gmail.com],
  pad(right: 6pt, grid(
    columns: (auto, auto),
    column-gutter: 12pt,
    row-gutter: 0.52em,
    align: (right, left),
    underline[INV\#], [INV0001],
    underline[INV DATE], [2000/01/01],
  )),
)

#v(2cm)

#striped(
  columns: (auto, 1fr, auto, auto, auto),
  align: (left, left, right, right, right),
  head[ITEM], head[DESCRIPTION], head[HRS], head[RATE/HR], head[SUB TOTAL],
  table.hline(y: 1, stroke: 0.4pt),
  [ 1st Dec], [Random Project], [8], [£20.00], [£160.00],
  [ 2nd Dec], [Random Project], [7], [£20.00], [£140.00],
  [ 3rd Dec], [Random Project], [6], [£20.00], [£120.00],
)

#v(10.5pt)

#striped(
  columns: (auto, 1fr, auto, auto, auto),
  align: (left, left, right, right, right),
  head[EXPENSE], head[DESCRIPTION], head[QTY], head[RATE], head[SUB TOTAL],
  table.hline(y: 1, stroke: 0.4pt),
  [1], [Travel cost], [2], [£10.00], [£20.00],
)

#v(0.35em)
#total[£440.00]

#v(3cm - 2pt)

// Kept together, so that it moves to the next page as a whole rather than being split
#block(breakable: false, grid(
  columns: (1fr, auto),
  inset: (x: 6pt),
  row-gutter: 0.52em,
  underline[Payment Instructions:], [#underline[Terms:] 7 days],
  [Account Name: Foo Bar Account \ Account Address: 2 Baz, Qux, Quux \ Account Number: 12345678 \ Bank Sort Code: 12-34-56 \ Bank: Super Cool Bank],
))
