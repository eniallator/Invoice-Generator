import re
import argparse
import pathlib
from os import path, makedirs
from subprocess import Popen
from configparser import ConfigParser
from typing import Dict


def parse_item_path(item_path: str, base_path: str) -> str:
    if item_path[0] in "\"'" and item_path.endswith(item_path[0]):
        item_path = item_path[1:-1]
    return (
        path.realpath(path.join(base_path, item_path))
        if item_path.startswith(".")
        else path.abspath(item_path)
    )


class ContextVariables:
    IMPORT_SEPARATOR = "\n"

    def __init__(self, base_path: str):
        self.base_path = base_path

        self.config = ConfigParser()
        self.config.add_section("META")

        self.fetch_imports()
        self.build_invoice_items()

    def combine_config(self, other_config: ConfigParser) -> None:
        for section in other_config.sections():
            if section not in self.config:
                self.config.add_section(section)
            for option in other_config.options(section):
                self.config.set(section, option, other_config.get(section, option))

    def fetch_imports(self) -> None:
        import_stack = [path.realpath(self.base_path)]
        seen_imports = set(import_stack)
        errored_imports = set()
        base_config = None
        while len(import_stack) > 0:
            import_path = import_stack.pop()
            new_config = ConfigParser()
            success = new_config.read(import_path)
            if not success:
                errored_imports.add(import_path)
                continue
            if base_config is None:
                base_config = new_config
            else:
                self.combine_config(new_config)
            new_imports = [
                parse_item_path(new_import + ".cfg", path.dirname(import_path))
                for new_import in self.config.get("META", "import", fallback="").split(
                    self.IMPORT_SEPARATOR
                )
                if new_import and new_import not in seen_imports
            ]
            self.config.set("META", "import", "")
            for new_import in new_imports[::-1]:
                seen_imports.add(new_import)
                import_stack.append(new_import)
        if base_config is not None:
            self.combine_config(base_config)
        if errored_imports:
            raise ImportError(
                "Could not import the following config files:\n"
                + "\n".join(errored_imports)
            )

    def build_invoice_items(self) -> None:
        item_prefix = "ITEM_"
        item_sections = list(
            sorted(
                filter(
                    lambda section: section.startswith(item_prefix),
                    self.config.sections(),
                )
            )
        )
        self.invoice_items = [dict(self.config[section]) for section in item_sections]
        total = 0
        total_recurring_yearly = 0
        for item, section in zip(self.invoice_items, item_sections):
            if "id" not in item:
                item["id"] = section[len(item_prefix) :]
            if "hrs" in item and "." in item["hrs"]:
                item["hrs"] = f"{float(item['hrs']):.2f}"
            if "rate" in item:
                item["rate"] = f"{float(item['rate']):.2f}"
            if "subtotal" not in item:
                try:
                    subtotal = f"{float(item['hrs']) * float(item['rate']):.2f}"
                except (ValueError, KeyError):
                    pass
                else:
                    item["subtotal"] = subtotal
            if "subtotal" in item:
                total += float(item["subtotal"])
            if "recurring_yearly" in item:
                item["subtotal"] += f" + \\pounds{item['recurring_yearly']}/year"
                total_recurring_yearly += float(item["recurring_yearly"])
        if "total_due" not in self.config["META"]:
            self.config.set("META", "total_due", f"{total:.2f}")
            self.config.set(
                "META",
                "total_recurring_yearly_due",
                f"{total_recurring_yearly:.2f}" if total_recurring_yearly > 0 else "",
            )

    def get_variable(self, var_id: str, extra: Dict[str, str] = {}) -> str:
        var_path = tuple(var_id.split("."))
        if len(var_path) > 1:
            section, key = var_path
        else:
            section, key = "META", var_path[0]
        return extra.get(section, {}).get(
            key, self.config.get(section, key, fallback="")
        )


class DynamicContentParser:
    context_variable_re = re.compile(r"{{\s*(?P<var_id>[\w\.]+)\s*}}")
    directive_re = re.compile(
        r"{\*\s*(?P<name>\w+)\s+(?P<rest>(?P<file_path>\"[^\"]+\"|'[^']+'|[^\s\"]+)?\s*(?P<args>[^\*]+)?)\s*\*}"
    )

    def directive_close_re(self, name: str) -> re.Pattern:
        return re.compile(r"{/\*\s*" + name + r"\s*\*}")

    def sanitize_args(self, args: str | None) -> str | None:
        return args.strip() if args is not None and args.strip() else None

    def __init__(self, context_variables: ContextVariables, base_path: str):
        self.context_variables = context_variables
        self.base_path = base_path

    def insert_variable(self, match: re.Match, extra: Dict[str, str] = {}) -> str:
        variable = self.context_variables.get_variable(
            match.group("var_id"), extra=extra
        )
        return variable if variable is not None else ""

    def directive_items(
        self, contents: str | None, contents_path: str, args: str | None
    ) -> str:
        if args is not None:
            raise ValueError("Items directive doesn't take arguments")
        if contents is None:
            raise ValueError("Items directive needs a template to insert items into")
        items_string = ""
        for item in self.context_variables.invoice_items:
            items_string += DynamicContentParser(
                self.context_variables, contents_path
            ).parse_string(contents, {"ITEM": item})
        return items_string

    def insert_directive(self, match: re.Match, template_contents: str) -> (str, int):
        directive_name = f"directive_{match.group('name')}"
        if not hasattr(self, directive_name):
            raise ValueError(f"Unknown directive: {match.group('name')}")
        else:
            directive = getattr(self, directive_name)
        file_path = (
            parse_item_path(match.group("file_path"), self.base_path)
            if match.group("file_path") is not None
            else None
        )
        if file_path is not None and path.isfile(file_path):
            with open(file_path, "r") as file_handle:
                child_contents = file_handle.read()
            return (
                directive(
                    child_contents,
                    path.dirname(file_path),
                    self.sanitize_args(match.group("args")),
                ),
                match.end(),
            )
        close_match = self.directive_close_re(match.group("name")).search(
            template_contents[match.end() :],
        )
        if close_match is not None:
            child_contents = template_contents[
                match.end() : close_match.start() + match.end()
            ]
            return (
                directive(
                    child_contents,
                    self.base_path,
                    self.sanitize_args(match.group("rest")),
                ),
                close_match.end() + match.end(),
            )
        raise ValueError(f"Could not find contents for directive {match.group('name')}")

    def parse_string(self, contents: str, extra: Dict[str, str] = {}) -> str:
        directives = [match for match in self.directive_re.finditer(contents)]
        for directive in directives[::-1]:
            replacement, end_pos = self.insert_directive(directive, contents)
            contents = contents[: directive.start()] + replacement + contents[end_pos:]
        return self.context_variable_re.sub(
            lambda match: self.insert_variable(match, extra=extra), contents
        )


if __name__ == "__main__":
    arg_parser = argparse.ArgumentParser(description="Generate an invoice")
    arg_parser.add_argument(
        "--cfg",
        "-c",
        help="Config file to fill the invoice out with",
        type=pathlib.Path,
        required=True,
        dest="cfg",
    )
    arg_parser.add_argument(
        "--template",
        "-t",
        help="LaTeX template file to use with the config variables",
        type=pathlib.Path,
        dest="template",
    )
    arg_parser.add_argument(
        "--out-path",
        "-o",
        help="Output .tex path where to generate the auxiliary/tex/pdf files",
        type=pathlib.Path,
        dest="out_path",
    )
    arg_parser.add_argument(
        "--quote",
        "-q",
        help="In quote mode or not",
        default=False,
        action="store_const",
        const=True,
    )
    prog_args = arg_parser.parse_args()

    out_path = (
        prog_args.out_path
        if prog_args.out_path is not None
        else "./out/quote.tex"
        if prog_args.quote
        else "./out/invoice.tex"
    )
    template = (
        prog_args.template
        if prog_args.template is not None
        else "./quote_template.tex"
        if prog_args.quote
        else "./invoice_template.tex"
    )

    context_variables = ContextVariables(prog_args.cfg)
    parser = DynamicContentParser(
        context_variables, path.abspath(path.dirname(template))
    )
    out_dir = path.dirname(out_path)
    makedirs(out_dir, exist_ok=True)

    with open(template, "r") as file_handle:
        generated_invoice = parser.parse_string(file_handle.read())

    with open(out_path, "w") as file_handle:
        file_handle.write(generated_invoice)

    Popen(
        [
            "latexmk",
            "-synctex=1",
            "-interaction=nonstopmode",
            "-file-line-error",
            "-pdf",
            f"-aux-directory={out_dir}",
            f"-output-directory={out_dir}",
            out_path,
        ],
    ).wait()
