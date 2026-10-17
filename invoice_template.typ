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
#pad(top: 3pt, right: 6pt, align(right)[*{{ INVOICE_FROM.fullname }}* \ {{ INVOICE_FROM.address }} \ {{ INVOICE_FROM.contact }}])

#v(4pt)

#align(center)[#text(size: 14.4pt)[*INVOICE*]/*% when invoice_subheading >*/ \ #strong[{{ invoice_subheading }}]/*< when %*/]

#v(2pt)

#grid(
  columns: (1fr, auto),
  [#underline[Invoice To:] \ {{ INVOICE_TO.address }} \ Attention: {{ INVOICE_TO.fullname }} \ {{ INVOICE_TO.contact }}],
  pad(right: 6pt, grid(
    columns: (auto, auto),
    column-gutter: 12pt,
    row-gutter: 0.52em,
    align: (right, left),
    underline[INV\#], [{{ invoice_id }}],
    underline[INV DATE], [{{ invoice_date }}],
  )),
)

#v(2cm)/*% when ITEM_total_due >*/

#striped(
  columns: (auto, 1fr,/*% when ITEM_hrs >*/ auto,/*< when %*//*% when ITEM_days >*/ auto,/*< when %*//*% when ITEM_rate >*/ auto,/*< when %*/ auto),
  align: (left, left,/*% when ITEM_hrs >*/ right,/*< when %*//*% when ITEM_days >*/ right,/*< when %*//*% when ITEM_rate >*/ right,/*< when %*/ right),
  head[ITEM], head[DESCRIPTION],/*% when ITEM_hrs >*/ head[HRS],/*< when %*//*% when ITEM_days >*/ head[DAYS],/*< when %*//*% when ITEM_rate >*/ head[RATE/HR],/*< when %*/ head[SUB TOTAL],
  table.hline(y: 1, stroke: 0.4pt),/*% map ITEM >*/
  [{{ ITEM.id }}], [{{ ITEM.description }}],/*% when ITEM_hrs >*/ [{{ ITEM.hrs }}],/*< when %*//*% when ITEM_days >*/ [{{ ITEM.days }}],/*< when %*//*% when ITEM_rate >*/ [{{ PAYMENT.currency }}{{ ITEM.rate }}],/*< when %*/ [{{ PAYMENT.currency }}{{ ITEM.subtotal }}],/*< map %*/
)/*% unless EXPENSE_total_due >*/

#v(0.35em)
#total[{{ PAYMENT.currency }}{{ ITEM_total_due }}]/*< unless %*//*< when %*//*% when EXPENSE_total_due >*/

#v(10.5pt)

#striped(
  columns: (auto, 1fr,/*% when EXPENSE_qty >*/ auto,/*< when %*//*% when EXPENSE_rate >*/ auto,/*< when %*/ auto),
  align: (left, left,/*% when EXPENSE_qty >*/ right,/*< when %*//*% when EXPENSE_rate >*/ right,/*< when %*/ right),
  head[EXPENSE], head[DESCRIPTION],/*% when EXPENSE_qty >*/ head[QTY],/*< when %*//*% when EXPENSE_rate >*/ head[RATE],/*< when %*/ head[SUB TOTAL],
  table.hline(y: 1, stroke: 0.4pt),/*% map EXPENSE >*/
  [{{ EXPENSE.id }}], [{{ EXPENSE.description }}],/*% when EXPENSE_qty >*/ [{{ EXPENSE.qty }}],/*< when %*//*% when EXPENSE_rate >*/ [{{ PAYMENT.currency }}{{ EXPENSE.rate }}],/*< when %*/ [{{ PAYMENT.currency }}{{ EXPENSE.subtotal }}],/*< map %*/
)

#v(0.35em)
#total[{{ PAYMENT.currency }}/*% add ITEM_total_due EXPENSE_total_due %*/]/*< when %*/

#v(3cm - 2pt)

// Kept together, so that it moves to the next page as a whole rather than being split
#block(breakable: false, grid(
  columns: (1fr, auto),
  inset: (x: 6pt),
  row-gutter: 0.52em,
  underline[Payment Instructions:], [#underline[Terms:] {{ invoice_terms }}],
  [Account Name: {{ PAYMENT.account_name }}/*% when PAYMENT.account_address >*/ \ Account Address: {{ PAYMENT.account_address }}/*< when %*/ \ Account Number: {{ PAYMENT.account_number }} \ Bank Sort Code: {{ PAYMENT.bank_sort_code }} \ Bank: {{ PAYMENT.bank }}/*% when PAYMENT.bank_address >*/ \ Bank Address: {{ PAYMENT.bank_address }}/*< when %*/],
))
