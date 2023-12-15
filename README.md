# Invoice Generator

Welcome to my invoice generator! It contains a custom templating language for inserting context variables/directives.

## Command Usage

To generate the example invoice, use the following command:

```properties
python generate.py -c ./raw_invoices/johnDoe.2000.01.01.cfg
```

The following arguments exist:

- `--cfg`/`-c`
  - The config file entry point to get all the context variables from
- `--template`/`-t`
  - The template file to use (can in reality be any extension/file type, but this uses LaTeX). This defaults to `./invoice_template.tex`
- `--out-path`/`-o`
  - The output destination for all the auxiliary files as well as the output pdf that `latexmk` creates. This defaults to `./out/invoice.tex`
- `--quote`/`-q`
  - Alias for setting the default template to `./quote_template.tex` and the default out path to `./out/quote.tex`. So if they are provided, the given parameter(s) override this option.

## How It Works

If you like the look of the [example invoice pdf](./example_invoice.pdf) or the [example invoice LaTeX](./example_invoice.tex), the way that it is generated is using the [invoice template](./invoice_template.tex) which refers to the [invoice item](./invoice_item.tex) LaTeX file for generating individual invoice items.

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

Invoice items are sections which have the `ITEM_` prefix, where what follows is the item ID. e.g `ITEM_1` has an ID of `1`, but `ITEM_ONE` has an ID of `ONE`.

One implicit calculation that takes place is with the `recurring` options. If there are any instances of `recurring` inside the ITEM(s), then there will be a `total_recurring_due` option added to the `META` section.

To take advantage of the subtotal/total calculations, each item must have the following options: `rate`, and `hrs`. These are then used to work out a `subtotal` option. These subtotals are also added up into a `total_due` option in the `META` section. For example:

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

when parsed will become the equivalent of passing the following in:

```properties
[META]

total_due=36.00
total_recurring_due=11.00

[ITEM_1]

id=1
subtotal=30.00
hrs=5.00
rate=6.00
recurring=7.00

[ITEM_2]

id=2
subtotal=6.00
hrs=2.00
rate=3.00
recurring=4.00
```

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

### Items Directive

Directives have the following syntax: `{* name (contents file path) args *}`, where `name` is the name of the directive, `contents file path` is the path to the contents which are given to the directive and `args` are the directive's arguments.

The items directive will take in a path of an external LaTeX file which is the contents file path and no other arguments. The file will be parsed with the context variables as well as any directives (due to the parser being recursive), as well as with the addition of the `ITEM` section added to the context variables, which is the current invoice item. For example:

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
{* items ./invoice_item.tex *}
Total: {{ total_due }}
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

### Inline Items Directive

Directives can also be inline, where there will also have to be a closing tag for the directive. Any contents in between the opening and closing tags will then be parsed and replaced by the directive's output.

The inline directive syntax is as follows: `{* name args *}...{/* name *}` where instead of a contents file path, the contents will be whats inside the opening and closing tags. One note is that the name has to be the same as the name in the opening tag.

All directives will be executed in the order that they appear. This means that any context from outer directives will be taken into account (e.g. the `ITEM` context variable can then be used alongside the optional directive to achieve some pretty complex situations)

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
ID, hrs, rate, subtotal{* items *}
{{ ITEM.id }}, {{ ITEM.hrs }}, {{ ITEM.rate }}, {{ ITEM.subtotal }}{/* items *}
Total: {{ total_due }}
```

Will generate the same output as above:

```LaTeX
Invoice Items:
ID, hrs, rate, subtotal
1, 5, 6.00, 30.00
2, 2, 3.00, 6.00
Total: 36.00
```

### Optional Directive

The optional directive takes in a single argument which is the path to a context variable. Then the content within the optional directive will only be shown if the context variable exists, and has a value.

There is also a counterpart for the optional directive, `optional_not` which does the inverse where if the variable doesn't exist, then the contents will show, otherwise the contents will be omitted.

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
ID, hrs, rate, subtotal{* optional total_recurring_due *}, Recurring{/* optional *}{* items *}
{{ ITEM.id }}, {{ ITEM.hrs }}, {{ ITEM.rate }}, {{ ITEM.subtotal }}{* optional total_recurring_due *}, {{ITEM.recurring}}{/* optional *}{/* items *}
Total: {{ total_due }}{* optional total_recurring_due *}
Total Recurring: {{total_recurring_due}}{/* optional *}
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
