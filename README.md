# Invoice Generator

Welcome to my invoice generator! It contains a custom templating language for inserting context variables/directives.

## Typical Flow

At its simplest, you write a raw invoice (copy the [example invoice config](./raw_invoices/johnDoe.2000.01.01.cfg) and change it), generate it and send the pdf it makes:

```properties
pnpm generate ./raw_invoices/janeRoe.2000.04.03.cfg
```

If you track your time with the Time Tracker app and use Gmail, the optional [time tracker](#time-tracker-optional), [exporting](#exporting-invoices-optional) and [emailing](#emailing-invoices-optional) steps can do the rest of the work for a month's invoices, so the flow becomes:

```properties
pnpm fetch-db
pnpm draft-invoices 2000 3
pnpm generate ./raw_invoices/janeRoe.2000.04.03.cfg
pnpm export ./raw_invoices/janeRoe.2000.04.03.cfg
pnpm email-invoices ./raw_invoices/janeRoe.2000.04.03.cfg
```

1. `pnpm fetch-db` copies the newest database backup from Google Drive into `timetracker_databases/`.
2. `pnpm draft-invoices 2000 3` writes a draft raw invoice for every client with time in March 2000, with an item for each day worked, and the next invoice id. Look over each draft and edit it, for example to add expenses or extra items that are not in the app.
3. `pnpm generate <cfg>` fills out the template from the raw invoice and builds the pdf, once for each invoice.
4. `pnpm export <cfg>` keeps a copy of the invoice: its pdf goes into your invoices folder, and its fully worked out config into a `raw_invoices` folder next to it.
5. `pnpm email-invoices <cfg>` creates a Gmail draft for the invoice with the exported pdf attached. Look over the draft in Gmail, and send it from there.

Each of these steps works on its own, so you can start or stop anywhere in the flow.

## Command Usage

To generate the example invoice, use the following command:

```properties
pnpm install
pnpm generate ./raw_invoices/johnDoe.2000.01.01.cfg
```

This needs Node.js 25.4 or newer. The pdf is built by [Typst](https://typst.app/), using the `@myriaddreamin/typst-ts-node-compiler` package, which works on every platform, so there is nothing else to install.

The following arguments exist:

- `cfg` (positional)
  - The config file entry point to get all the context variables from
- `--template`/`-t`
  - The template file to use (can in reality be any extension/file type, but this uses Typst). This defaults to `./invoice_template.typ`
- `--out-path`/`-o`
  - The output destination for the filled out Typst file. The pdf that Typst makes from it goes next to it. This defaults to `SAME`, which names it after the config file (e.g. `./out/johnDoe.2000.01.01.typ`)
- `--quote`/`-q`
  - Alias for setting the default template to `./quote_template.typ`. So if the template is provided, the given parameter overrides this option.

To rebuild the example `.typ` and pdf files, run `pnpm regenerate-examples`.

## How It Works

If you like the look of the [example invoice pdf](./example_invoice.pdf) or the [example invoice Typst](./example_invoice.typ), the way that it is generated is using the [invoice template](./invoice_template.typ).

These templates are then filled out with context variables starting from the [example invoice config](./raw_invoices/johnDoe.2000.01.01.cfg). This then also imports the [example client](./clients/johnDoe.cfg) and the [example my_info config](./my_info.cfg).

This generator also works with creating quotes! See all the quote counterpart examples for the above. Creating quotes works in the exact same way, it just uses a different template.

## Config Files

Config files use the properties syntax as described in the [configparser documentation](https://docs.python.org/3/library/configparser.html#supported-ini-file-structure).

The values are put into the templates as they are, so with the Typst templates they are Typst markup. In particular:

- A line break is a backslash followed by a space, e.g. `address=1 Road,\ Town\ County`.
- `@` starts a reference in Typst, so write email addresses as `jane\@example.com`.
- Other characters that Typst uses (such as `#`, `$` and `*`) need a backslash in front of them to be shown as they are.
- Symbols like the currency can be written as they are, e.g. `currency=£`.

### Importing Other Config Files

Imports can be specified in the `META` section of config with the `import` option. All imports must be separated with newlines. You also don't specify the extension when importing, the `.cfg` extension is added implicitly. For example:

```properties
[META]

import=./default
  ./anothercfg
  ../clients/my-client
```

Later imports override earlier ones, so this is also a good way to keep a history of your own details: put each set in its own file (e.g. `me/2000.01.01.cfg`, named after the first invoice that used it), import the current one from your default config, and have older invoices import the one that was current when they were made.

### Invoice Items

Invoice items are sections which have the `ITEM_` prefix, where what follows is the item ID. e.g `ITEM_1` has an ID of `1`, but `ITEM_ONE` has an ID of `ONE`. Any other group of sections with a shared prefix (e.g. `EXPENSE_`) works in exactly the same way. Nothing is worked out for a group until it is used, either by mapping over it or by using one of its variables.

To take advantage of the subtotal/total calculations, each item must have the following options: `rate`, and `hrs`. These are then used to work out a `subtotal` option. Prices (`rate` and `price`) are always formatted to 2 decimal places, whereas quantities (`hrs`, `days` and `qty`) are only reformatted if they are written with a decimal point. For example:

```properties
[ITEM_1]

hrs=5
rate=6
recurring=7

[ITEM_2]

hrs=2
rate=3
recurring=4
```

will give each item the following options:

```properties
[ITEM_1]

id=1
subtotal=30.00
hrs=5
rate=6.00
recurring=7.00

[ITEM_2]

id=2
subtotal=6.00
hrs=2
rate=3.00
recurring=4.00
```

Every group also has some variables of its own, which can be used like any other context variable. They live in the `META` section (so `ITEM_total_due` is the same as `META.ITEM_total_due`) and are named after the group's prefix followed by an underscore:

- `ITEM_total_due`
  - The subtotals of all the items added up (`36.00` here).
- `ITEM_total_recurring_due`
  - The `recurring` options of all the items added up (`11.00` here). This is empty if nothing recurs.
- `ITEM_<option>` (e.g. `ITEM_hrs`)
  - Every item's value for the option, as it was written in the config, joined with commas (`5, 2` here). This is handy for checking whether any item has an option with the `when` directive.

If the name could be split into a prefix and an option in more than one way, the longest prefix that has items is used. A variable in the config with the same name always takes priority. To combine the totals of different groups, see the [add directive](#add-directive).

## Template Files

Template files can have context variables inserted (from the config files).

### Context Variables

These have the following format: `{{ section.option }}` and can be inserted anywhere inside the file. The other format you can use is `{{ option }}`, where the section is implicitly set to `META`. For example:

```typst
#underline[INV DATE] {{ invoice_date }}
Pay to: {{ PAYMENT.account_name }}
```

with the following config file input:

```properties
[META]

invoice_date=2000/01/01

[PAYMENT]

account_name=John Doe
```

will generate the following Typst:

```typst
#underline[INV DATE] 2000/01/01
Pay to: John Doe
```

Note:\
If the parser cannot find a specific context variable, it will replace the variable with an empty string.

### Map Directive

Directives have two forms. The first is a block, `/*% name args >*/contents/*< name %*/`, where `name` is the name of the directive, `args` is everything after the name (it is optional for some directives) and the contents are everything between the opening and closing tags (the closing tag must have the same name). The second is self closing, `/*% name args %*/`, which has no contents. The `>` points at the contents that follow the opening tag, and the `<` points back at the contents that came before the closing tag.

The tags are Typst block comments, so a template is still valid Typst wherever they are put (even inside a function's arguments, where Typst would not accept anything else), and editors will not report errors for them. Only a comment that starts with `/*%` is a directive, so ordinary comments are left alone.

Some directives (`map`, `when` and `unless`) can also take their contents from another file. For these, use the self closing form where the first argument is the path of the file, followed by the directive's other arguments. Relative paths are resolved from the file that the directive is in, and paths can be quoted with `"` or `'` if they contain spaces.

The map directive takes in the section prefix (e.g. `ITEM`) to map over, and repeats its contents once for every section named `<prefix>_<id>`, in alphabetical order. The contents will be parsed with the context variables as well as any directives (due to the parser being recursive), as well as with the addition of the section prefix added to the context variables, which is the current invoice item. For example:

config:

```properties
[ITEM_1]

hrs=5
rate=6

[ITEM_2]

hrs=2
rate=3
```

invoice template:

```typst
Invoice Items:
ID, hrs, rate, subtotal
/*% map ./invoice_item.typ ITEM %*/
Total: {{ ITEM_total_due }}
```

./invoice_item.typ

```typst
{{ ITEM.id }}, {{ ITEM.hrs }}, {{ ITEM.rate }}, {{ ITEM.subtotal }}
```

Will all generate:

```typst
Invoice Items:
ID, hrs, rate, subtotal
1, 5, 6.00, 30.00
2, 2, 3.00, 6.00
Total: 36.00
```

Everything else stays available inside the contents too: the group's variables (like `ITEM_total_due`) and the items of any outer maps, so maps can be nested. An inner item with the same prefix replaces the outer one.

### Inline Items Directive

Instead of using a contents file, the contents can be written between the opening and closing tags. Any contents in between the tags will then be parsed and replaced by the directive's output.

The inline directive syntax is as follows: `/*% name args >*/.../*< name %*/`. One note is that the name has to be the same as the name in the opening tag.

All directives will be executed in the order that they appear. This means that any context from outer directives will be taken into account (e.g. the `ITEM` context variable can then be used alongside the `when` directive to achieve some pretty complex situations)

Inline directives example:

Using the same config as above:

```properties
[ITEM_1]

hrs=5
rate=6

[ITEM_2]

hrs=2
rate=3
```

With the following invoice template:

```typst
Invoice Items:
ID, hrs, rate, subtotal/*% map ITEM >*/
{{ ITEM.id }}, {{ ITEM.hrs }}, {{ ITEM.rate }}, {{ ITEM.subtotal }}/*< map %*/
Total: {{ ITEM_total_due }}
```

Will generate the same output as above:

```typst
Invoice Items:
ID, hrs, rate, subtotal
1, 5, 6.00, 30.00
2, 2, 3.00, 6.00
Total: 36.00
```

### When Directive

The when directive takes in a single argument which is the path to a context variable. Then the content within the when directive will only be shown if the context variable exists, and has a value.

There is also a counterpart for the when directive, `unless` which does the inverse where if the variable doesn't exist, then the contents will show, otherwise the contents will be omitted.

For example:

With the following config:

```properties
[ITEM_1]

hrs=5
rate=6
recurring=40

[ITEM_2]

hrs=2
rate=3
recurring=40
```

With the following template:

```typst
Invoice Items:
ID, hrs, rate, subtotal/*% when ITEM_total_recurring_due >*/, Recurring/*< when %*//*% map ITEM >*/
{{ ITEM.id }}, {{ ITEM.hrs }}, {{ ITEM.rate }}, {{ ITEM.subtotal }}/*% when ITEM_total_recurring_due >*/, {{ITEM.recurring}}/*< when %*//*< map %*/
Total: {{ ITEM_total_due }}/*% when ITEM_total_recurring_due >*/
Total Recurring: {{ITEM_total_recurring_due}}/*< when %*/
```

Will generate:

```typst
Invoice Items:
ID, hrs, rate, subtotal, Recurring
1, 5, 6.00, 30.00, 40.00
2, 2, 3.00, 6.00, 40.00
Total: 36.00
Total Recurring: 80.00
```

However, with this config:

```properties
[ITEM_1]

hrs=5
rate=6

[ITEM_2]

hrs=2
rate=3
```

The following will be generated (using the same template):

```typst
Invoice Items:
ID, hrs, rate, subtotal
1, 5, 6.00, 30.00
2, 2, 3.00, 6.00
Total: 36.00
```

### Add Directive

The add directive adds up context variables and is replaced by the total, shown to 2 decimal places. It needs at least two variables, separated by whitespace, which can be given as the arguments, as the contents or a mixture of the two (the arguments and contents are simply joined together). Variables that are empty or don't exist count as zero. This is how the totals of different groups can be combined. For example:

With the following config:

```properties
[ITEM_1]

hrs=5
rate=6

[EXPENSE_1]

qty=2
price=10
```

All of these templates:

```typst
Total: /*% add ITEM_total_due EXPENSE_total_due %*/
Total: /*% add ITEM_total_due >*/EXPENSE_total_due/*< add %*/
Total: /*% add >*/ITEM_total_due EXPENSE_total_due/*< add %*/
```

Will generate:

```typst
Total: 50.00
Total: 50.00
Total: 50.00
```

## Time Tracker (optional)

Everything above works on its own: you can always write a raw invoice or quote by hand and run `pnpm generate` on it. If you track your time with the [Time Tracker app](https://play.google.com/store/apps/details?id=com.aadhk.time) and have it automatically back up its database to Google Drive, these scripts can draft each month's raw invoices from it. None of this is needed to use the generator or to run the tests.

To set it up, copy `.env.example` to `.env` (which is gitignored) and fill it in:

- `TIMETRACKER_DRIVE_FOLDER`
  - The folder that Google Drive syncs the app's backups into.
- `ROUNDING_THRESHOLD_MINUTES`
  - The default rounding threshold, see [rounding](#rounding).

### Fetching the database

```properties
pnpm fetch-db
```

This copies the newest backup (`timetracker_YYYY_MM_DD_auto_database.db`) from the Drive folder into `timetracker_databases/`, which is gitignored as it holds client data.

### Drafting raw invoices

```properties
pnpm draft-invoices 2000 3
```

This writes a draft raw invoice for every client with billable time in that month (March 2000 here), using the newest database in `timetracker_databases/`. Each is named after the client's config file and today's date, and gets the next invoice id. For example, with the following client config:

```properties
[META]

default_description=Consulting
```

and two days of work, it writes `raw_invoices/janeRoe.2000.04.03.cfg` (when run on 3rd April 2000) containing:

```properties
[META]

import=./default
    ../clients/janeRoe
invoice_id=AB0042
invoice_date=2000/04/03

[ITEM_ 1st Mar]

description=Consulting
hrs=8
rate=50

[ITEM_ 2nd Mar]

description=Consulting
hrs=7
rate=50
```

Edit the draft however you like (add items, expenses or notes), and then generate it as usual. The following apply:

- There is an item for each day, and each project and rate worked on a day is its own item. Several in one day are numbered in the order they started, e.g. `1st Mar (pt 1)` and `1st Mar (pt 2)`. Single digit days are written with a leading space (as in the `[ITEM_ 1st Mar]` above), so that the items sort in day order. Items that round down to no hours are left out.
- The item's description is the notes from the app if there are any, and otherwise the client's `default_description`.
- Expenses in the app for the month become `EXPENSE_` sections.
- A client's config is matched to its name in the app by its file name (ignoring case and spacing, so `Jane Roe` is `janeRoe.cfg`), or by `timetracker_client=<name in the app>` in its `META` section. Clients without a config are skipped, with a warning.
- Existing drafts are never overwritten.
- `--client <name>` only drafts that client, and `--db <path>` uses a different database.

#### Rounding

Hours are rounded so that the month's total is a whole number of hours, and so is every item. The month's total rounds up if the minutes past the last whole hour are more than the threshold, and down otherwise. Every item then starts rounded up, and the items with the fewest minutes past the hour (the earliest first when they are equal) are rounded down until they add up to the month's total. For example, with a threshold of 30 minutes, days of 7h55, 7h40 and 7h10 total 22h45, which rounds up to 23 hours, so the 7h10 day (the fewest minutes past the hour) is rounded down:

| Worked | Rounded |
| ------ | ------- |
| 7h55   | 8       |
| 7h40   | 8       |
| 7h10   | 7       |

The threshold is `ROUNDING_THRESHOLD_MINUTES` unless a client's `META` section has its own `rounding_threshold_minutes`.

#### Invoice ids

The ids that have been used are kept in `.invoice-numbers.json` (gitignored). A new draft continues from the last id that was allocated, or from the highest `invoice_id` in `raw_invoices/` if there is no such file yet. The id is recorded against the draft's file name, so writing the same draft again (say after deleting it to start again) reuses its id instead of using up another number.

`--invoice-id <id>` uses a specific id for a draft instead, without changing the last id that new drafts continue from. This is for one invoice, so if several clients have time that month, say which with `--client`.

## Exporting Invoices (optional)

`pnpm export` keeps a record of each invoice you have made, so that your invoices folder is the place to look for what was sent. Once an invoice's pdf has been generated:

```properties
pnpm generate ./raw_invoices/janeRoe.2000.04.03.cfg
pnpm export ./raw_invoices/janeRoe.2000.04.03.cfg
```

This copies the pdf to `janeRoe.2000.04.03.pdf` in the folder that `EXPORT_PDF_DIR` points to, and writes the invoice's fully resolved config to `janeRoe.2000.04.03.cfg` in the folder that `EXPORT_CFG_DIR` points to. Set both in `.env`, as in [.env.example](./.env.example). The config folder is meant to be a `raw_invoices` folder next to the invoices folder, but they can be anywhere.

The resolved config is the raw invoice with everything worked out, so it does not depend on the files it imports (like your details and the client's), which may change later:

- Everything it imports is merged in, so it has no `import`.
- The items the template used are filled out: each has its `id` and its `subtotal`, and the numbers are formatted.
- The totals the template used are written into `META`, e.g. `ITEM_total_due`.

It is made after rendering the template, from what the template actually used, so groups it did not use are left as you wrote them. It can be used as a raw invoice itself, and generates the same invoice: `pnpm generate` it to check.

An invoice that has already been exported is not replaced, unless you pass `--overwrite`. Use `--template`/`-t` (or `--quote`/`-q`) for an invoice that was generated with a different template.

## Emailing Invoices (optional)

Once an invoice's pdf has been generated and [exported](#exporting-invoices-optional), `pnpm email-invoices` can create a Gmail draft for it with the exported pdf (from `EXPORT_PDF_DIR`) attached, ready for you to look over and send. It only ever creates drafts, it is not able to read or send any email. This is also optional, and nothing else needs it.

```properties
pnpm generate ./raw_invoices/janeRoe.2000.04.03.cfg
pnpm export ./raw_invoices/janeRoe.2000.04.03.cfg
pnpm email-invoices ./raw_invoices/janeRoe.2000.04.03.cfg
```

Each invoice is emailed to the `email` option in its `[INVOICE_TO]` section (several addresses can be separated with commas), or to `--to <addresses>` if that is given. The other option is `--template`/`-t`, for the email template to use (the default is [email_template.txt](./email_template.txt)).

The email template uses the same context variables and directives as the other templates, and its first line is the subject. For example, with the following config:

```properties
[META]

invoice_id=AB0042
invoice_date=2000/04/03
invoice_terms=7 days

[INVOICE_TO]

fullname=Jane Roe
email=jane@example.com

[INVOICE_FROM]

fullname=John Doe
```

the default template makes an email to `jane@example.com` with the subject `Invoice AB0042` and the following body:

```text
Hi Jane Roe,

Please find attached invoice AB0042, dated 2000/04/03. Payment details are on the invoice, and the terms are 7 days.

Let me know if you have any questions.

Thanks,
John Doe
```

### Setting up Gmail

This needs a Google Cloud project (it is free) that lets this create drafts in your Gmail:

1. In the [Google Cloud console](https://console.cloud.google.com/), create a project and enable the Gmail API for it.
2. Set up the OAuth consent screen, and add your own Google account as a test user. Test mode makes the access it is given expire after 7 days, so to avoid having to approve it again every week, publish the app (it stays private to you, and only shows an "unverified app" warning when you approve it).
3. Create an OAuth client ID with the "Desktop app" type, and download its JSON file as `.gmail-credentials.json` in this folder.
4. Set `GMAIL_CREDENTIALS_FILE` (and optionally `GMAIL_TOKEN_FILE`) in `.env`, as in [.env.example](./.env.example).

The first time you run `pnpm email-invoices` it prints a link to open in your browser, where you approve it creating drafts, and it then keeps the token that gives in `.gmail-token.json`. Both of these files are gitignored.
