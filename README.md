# Invoice Generator

Welcome to my invoice generator! It contains a custom templating language for inserting context variables/directives.

## Command Usage

To generate the example invoice, use the following command:

```properties
pnpm install
pnpm generate ./raw_invoices/johnDoe.2000.01.01.cfg
```

This needs Node.js 25.4 or newer, as well as `latexmk` to build the pdf.

The following arguments exist:

- `cfg` (positional)
  - The config file entry point to get all the context variables from
- `--template`/`-t`
  - The template file to use (can in reality be any extension/file type, but this uses LaTeX). This defaults to `./invoice_template.tex`
- `--out-path`/`-o`
  - The output destination for all the auxiliary files as well as the output pdf that `latexmk` creates. This defaults to `SAME`, which names it after the config file (e.g. `./out/johnDoe.2000.01.01.tex`)
- `--quote`/`-q`
  - Alias for setting the default template to `./quote_template.tex`. So if the template is provided, the given parameter overrides this option.

## How It Works

If you like the look of the [example invoice pdf](./example_invoice.pdf) or the [example invoice LaTeX](./example_invoice.tex), the way that it is generated is using the [invoice template](./invoice_template.tex).

These templates are then filled out with context variables starting from the [example invoice config](./raw_invoices/johnDoe.2000.01.01.cfg). This then also imports the [example client](./clients/johnDoe.cfg) and the [example my_info config](./my_info.cfg).

This generator also works with creating quotes! See all the quote counterpart examples for the above. Creating quotes works in the exact same way, it just uses a different template.

## Config Files

Config files use the properties syntax as described in the [configparser documentation](https://docs.python.org/3/library/configparser.html#supported-ini-file-structure).

### Importing Other Config Files

Imports can be specified in the `META` section of config with the `import` option. All imports must be separated with newlines. You also don't specify the extension when importing, the `.cfg` extension is added implicitly. For example:

```properties
[META]

import=./default
  ./anothercfg
  ../clients/my-client
```

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

```LaTeX
\underline{INV DATE} {{ invoice_date }}
Pay to: {{ PAYMENT.account_name }}
```

with the following config file input:

```properties
[META]

invoice_date=2000/01/01

[PAYMENT]

account_name=John Doe
```

will generate the following LaTeX:

```LaTeX
\underline{INV DATE} 2000/01/01
Pay to: John Doe
```

Note:\
If the parser cannot find a specific context variable, it will replace the variable with an empty string.

### Map Directive

Directives have two forms. The first is a block, `{* name args *}contents{/* name *}`, where `name` is the name of the directive, `args` is everything after the name (it is optional for some directives) and the contents are everything between the opening and closing tags (the closing tag must have the same name). The second is self closing, `{* name args */}`, which has no contents.

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

```LaTeX
Invoice Items:
ID, hrs, rate, subtotal
{* map ./invoice_item.tex ITEM */}
Total: {{ ITEM_total_due }}
```

./invoice_item.tex

```LaTeX
{{ ITEM.id }}, {{ ITEM.hrs }}, {{ ITEM.rate }}, {{ ITEM.subtotal }}
```

Will all generate:

```LaTeX
Invoice Items:
ID, hrs, rate, subtotal
1, 5, 6.00, 30.00
2, 2, 3.00, 6.00
Total: 36.00
```

Everything else stays available inside the contents too: the group's variables (like `ITEM_total_due`) and the items of any outer maps, so maps can be nested. An inner item with the same prefix replaces the outer one.

### Inline Items Directive

Instead of using a contents file, the contents can be written between the opening and closing tags. Any contents in between the tags will then be parsed and replaced by the directive's output.

The inline directive syntax is as follows: `{* name args *}...{/* name *}`. One note is that the name has to be the same as the name in the opening tag.

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

```LaTeX
Invoice Items:
ID, hrs, rate, subtotal{* map ITEM *}
{{ ITEM.id }}, {{ ITEM.hrs }}, {{ ITEM.rate }}, {{ ITEM.subtotal }}{/* map *}
Total: {{ ITEM_total_due }}
```

Will generate the same output as above:

```LaTeX
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

```LaTeX
Invoice Items:
ID, hrs, rate, subtotal{* when ITEM_total_recurring_due *}, Recurring{/* when *}{* map ITEM *}
{{ ITEM.id }}, {{ ITEM.hrs }}, {{ ITEM.rate }}, {{ ITEM.subtotal }}{* when ITEM_total_recurring_due *}, {{ITEM.recurring}}{/* when *}{/* map *}
Total: {{ ITEM_total_due }}{* when ITEM_total_recurring_due *}
Total Recurring: {{ITEM_total_recurring_due}}{/* when *}
```

Will generate:

```LaTeX
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

```LaTeX
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

```LaTeX
Total: {* add ITEM_total_due EXPENSE_total_due */}
Total: {* add ITEM_total_due *}EXPENSE_total_due{/* add *}
Total: {* add *}ITEM_total_due EXPENSE_total_due{/* add *}
```

Will generate:

```LaTeX
Total: 50.00
Total: 50.00
Total: 50.00
```
