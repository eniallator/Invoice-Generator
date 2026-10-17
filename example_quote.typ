// Typst Simple Quote Template
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

// Header, for company, quote info
#pad(top: 3pt, right: 6pt, align(right)[*Foo Bar* \ 1 Baz\ Qux\ Quux \ Email: foo\@bar.baz\ Mobile: +01 2345 678910])

#v(-1.5pt)

#align(center)[#text(size: 14.4pt)[*QUOTE*]]

#v(2pt)

#grid(
  columns: (1fr, auto),
  [#underline[Quote To:] \ 1 Makebelieve Avenue,\ Sim City\ America \ Attention: John Doe \ Email: johndoe\@gmail.com],
  pad(right: 6pt, grid(
    columns: (auto, auto),
    column-gutter: 12pt,
    row-gutter: 0.52em,
    align: (right, left),
    underline[QUOTE\#], [QUT0001],
    underline[QUOTE DATE], [2000/01/01],
  )),
)

#v(1cm - 2pt)

#striped(
  columns: (auto, 1fr, auto),
  align: (left, left, right),
  head[ITEM], head[DESCRIPTION], head[SUB TOTAL],
  table.hline(y: 1, stroke: 0.4pt),
  [1], [Random Project], [£300.00],
  [2], [Another Project], [£200.00],
  [3], [Final Project], [£150.00],
)

#v(0.35em)
#total[£650.00]

#v(3cm - 3pt)

#underline[Payment Terms:] 7 days

#v(0.5cm)

#text(size: 9pt)[Any additional work not outlined in the responsibilities on the next page(s) is outside of the scope of this quote and will require an additional quote.]

#pagebreak()
#set page(numbering: "1") // Only the pages after the first have a page number

#text(size: 14.4pt)[Responsibilities]

#set par(justify: true)
#set list(indent: 12pt, body-indent: 7pt, tight: false, spacing: 0.9em)
- *Random Project* - Here's one of the example tasks I will complete for this project
- *Another Project* - Here's one of the example tasks I will complete for this other project
- *Final Project* - Here's one of the example tasks I will complete for this final project

