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

## How It Works

If you like the look of the [example invoice pdf](./example-invoice.pdf) or the [example invoice LaTeX](./example-invoice.tex), the way that it is generated is using the [invoice template](./invoice_template.tex) which refers to the [invoice item](./invoice_item.tex) LaTeX file for generating individual invoice items.

These templates are then filled out with context variables starting from the [example invoice config](./raw_invoices/johnDoe.2000.01.01.cfg). This then also imports the [example client](./clients/johnDoe.cfg) and the [example my_info config](./my_info.cfg).

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

To take advantage of the subtotal/total calculations, each item must have the following options: `rate`, and `hrs`. These are then used to work out a `subtotal` option. These subtotals are also added up into a `total_due` option in the `META` section. For example:

```properties
[ITEM_1]

hrs=5
rate=6

[ITEM_2]

hrs=2
rate=3
```

when parsed will become the equivalent of passing the following in:

```properties
[META]

total_due=36.00

[ITEM_1]

id=1
subtotal=30.00
hrs=5.00
rate=6.00

[ITEM_2]

id=2
subtotal=6.00
hrs=2.00
rate=3.00
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
If the parser cannot find a specific context variable, it will replace it with an empty string.

### Items Directive

Directives have the following syntax: `{* name args *}`, where `name` is the name of the directive and `args` are the directive's arguments.

The items directive will take in a path of an external LaTeX file, where the file will be parsed with the context variables, except with the addition of the `ITEM` section added to the context variables, which is the current invoice item. For example:

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
1, 5.00, 6.00, 30.00
2, 2.00, 3.00, 6.00
Total: 36.00
```
