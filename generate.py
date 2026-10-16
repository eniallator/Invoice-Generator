import argparse
import pathlib
import re
from configparser import ConfigParser
from os import makedirs, path
from subprocess import Popen
from typing import Dict, List, Optional, cast


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

    built_items: Dict[str, List[Dict[str, str]]] = {}

    def __init__(self, base_path: str):
        self.base_path = base_path

        self.config = ConfigParser()
        self.config.add_section("META")

        self.fetch_imports()

        self.calculate_total_due = "total_due" not in self.config["META"]
        self.calculate_total_recurring_due = (
            "total_recurring_due" not in self.config["META"]
        )

        self.calculate_items("ITEM")
        self.calculate_items("EXPENSE")

    def combine_config(self, other_config: ConfigParser) -> None:
        for section in other_config:
            if section not in self.config:
                self.config.add_section(section)
            for option, value in other_config.items(section):
                self.config.set(section, option, value)

    def fetch_imports(self) -> None:
        import_stack = [path.realpath(self.base_path)]
        seen_imports = set(import_stack)
        errored_imports = set[str]()
        base_config = None
        while len(import_stack) > 0:
            import_path = import_stack.pop()
            new_config = ConfigParser()
            if not new_config.read(import_path):
                errored_imports.add(import_path)
                continue
            if base_config is None:
                base_config = new_config
            else:
                self.combine_config(new_config)
            new_imports = [
                parse_item_path(new_import + ".cfg", path.dirname(import_path))
                for new_import in new_config.get("META", "import", fallback="").split(
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

    def calculate_items(self, prefix: str) -> List[Dict[str, str]]:
        if prefix in self.built_items:
            return self.built_items[prefix]
        all_section = f"ALL_{prefix}S"
        full_prefix = f"{prefix}_"
        sections = list(
            sorted(filter(lambda section: section.startswith(full_prefix), self.config))
        )
        self.built_items[prefix] = [dict(self.config[section]) for section in sections]
        total = 0
        total_recurring = 0
        build_all_items = False
        for item, section in zip(self.built_items[prefix], sections):
            build_all_items = build_all_items or all_section not in self.config
            if build_all_items and not self.config.has_section(all_section):
                self.config.add_section(all_section)
            for key, value in item.items():
                self.config.set(
                    all_section,
                    key,
                    (
                        self.config.get(all_section, key) + ", " + value
                        if key in self.config.options(all_section)
                        else value
                    ),
                )
            if "id" not in item:
                item["id"] = section[len(full_prefix) :]
            for key in ("hrs", "days", "qty", "rate", "price"):
                if key in item and "." in item[key]:
                    item[key] = f"{float(item[key]):.2f}"
            if "subtotal" not in item:
                try:
                    numerator = item['hrs'] if 'hrs' in item else item["days"] if "days" in item else item['qty']
                    denominator = item['rate'] if 'rate' in item else item['price']
                    item["subtotal"] = f"{float(numerator) * float(denominator):.2f}"
                except (ValueError, KeyError):
                    pass
            if "subtotal" in item:
                total += float(item["subtotal"])
            if "recurring" in item:
                item["recurring"] = f"{float(item['recurring']):.2f}"
                total_recurring += float(item["recurring"])
        if build_all_items:
            self.config.set(all_section, "total_due", f"{total:.2f}")
            self.config.set(
                all_section,
                "total_recurring_due",
                f"{total_recurring:.2f}" if total_recurring > 0 else "",
            )
        if self.calculate_total_due:
            total_due = self.config.getfloat("META", "total_due", fallback=0.0)
            self.config.set("META", "total_due", f"{total_due + total:.2f}")
        if self.calculate_total_recurring_due:
            total_recurring_due = self.config.getfloat(
                "META", "total_recurring_due", fallback=0.0
            )
            self.config.set(
                "META",
                "total_recurring_due",
                f"{total_recurring_due + total_recurring:.2f}",
            )
        return self.built_items[prefix]

    def get_variable(self, var_id: str, extra: Dict[str, Dict[str, str]] = {}) -> str:
        var_path = tuple(var_id.split("."))
        if len(var_path) > 1:
            section, key = var_path
        else:
            section, key = "META", cast(tuple[str], var_path)[0]
        return extra.get(section, {}).get(
            key, self.config.get(section, key, fallback="")
        )


class DynamicContentParser:
    context_variable_re = re.compile(r"{{\s*(?P<var_id>[\w\.]+)\s*}}")
    directive_re = re.compile(
        r"{\*\s*(?P<name>\w+)\s+(?P<rest>(?P<file_path>\"[^\"]+\"|'[^']+'|[^\s\"]+)?\s*(?P<args>[^\*]+)?)\s*\*}"
    )

    def __init__(
        self,
        context_variables: ContextVariables,
        base_path: str,
        extra: Optional[Dict[str, Dict[str, str]]] = None,
    ):
        self.context_variables = context_variables
        self.base_path = base_path
        self.extra = extra if extra is not None else {}

    def directives_open_re(self, name: str) -> re.Pattern[str]:
        return re.compile(
            r"{\*\s*"
            + name
            + r'\s+(?P<rest>(?P<file_path>"[^"]+"|\'[^\']+\'|[^\s"]+)?\s*(?P<args>[^\*]+)?)\s*\*}'
        )

    def directives_close_re(self, name: str) -> re.Pattern[str]:
        return re.compile(r"{/\*\s*" + name + r"\s*\*}")

    def sanitize_args(self, args: Optional[str]) -> str | None:
        return args.strip() if args is not None and args.strip() else None

    def insert_variable(self, match: re.Match[str]) -> str:
        return self.context_variables.get_variable(
            match.group("var_id"), extra=self.extra
        )

    def directive_map(
        self, contents: str, contents_path: str, args: Optional[str]
    ) -> str:
        if args is None:
            raise ValueError(
                "map directive has a single argument for the context variable to check"
            )
        built = ""
        # TODO: Get variable first, then calculate var if it doesn't exist and can be calculated
        # ALSO iterate over the item_Ns
        for item in self.context_variables.calculate_items(args):
            built += DynamicContentParser(
                self.context_variables, contents_path, {args: item}
            ).parse_string(contents)
        return built

    def directive_when(
        self, contents: str, contents_path: str, args: Optional[str]
    ) -> str:
        if args is None:
            raise ValueError(
                "when directive has a single argument for the context variable to check"
            )
        return (
            DynamicContentParser(
                self.context_variables, contents_path, self.extra
            ).parse_string(contents)
            if self.context_variables.get_variable(args, extra=self.extra)
            else ""
        )

    def directive_unless(
        self, contents: str, contents_path: str, args: Optional[str]
    ) -> str:
        if args is None:
            raise ValueError(
                "unless directive has a single argument for the context variable to check"
            )
        return (
            ""
            if self.context_variables.get_variable(args, extra=self.extra)
            else DynamicContentParser(
                self.context_variables, contents_path, self.extra
            ).parse_string(contents)
        )

    def insert_directive(
        self, match: re.Match[str], template_contents: str
    ) -> tuple[str, int]:
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
        nested_count = 1
        nested_end_index = match.end()
        contents_end_index = match.end()
        close_match = None
        while nested_count > 0:
            close_match = self.directives_close_re(match.group("name")).search(
                template_contents[nested_end_index:],
            )
            if close_match is None:
                raise ValueError(
                    f"Could not find the closing directive for {match.group('name')}"
                )
            nested_count = (
                nested_count
                + len(
                    re.findall(
                        self.directives_open_re(match.group("name")),
                        template_contents[
                            nested_end_index : close_match.start() + nested_end_index
                        ],
                    )
                )
            ) - 1
            if nested_count > 0:
                contents_end_index += close_match.end()
            nested_end_index += close_match.end()
        if close_match is not None:
            child_contents = template_contents[
                match.end() : close_match.start() + contents_end_index
            ]
            return (
                directive(
                    child_contents,
                    self.base_path,
                    self.sanitize_args(match.group("rest")),
                ),
                close_match.end() + contents_end_index,
            )
        raise ValueError(f"Could not find contents for directive {match.group('name')}")

    def parse_string(self, contents: str) -> str:
        while directive := self.directive_re.search(contents):
            replacement, end_pos = self.insert_directive(directive, contents)
            contents = contents[: directive.start()] + replacement + contents[end_pos:]
        return self.context_variable_re.sub(self.insert_variable, contents)


if __name__ == "__main__":
    arg_parser = argparse.ArgumentParser(description="Generate an invoice")
    arg_parser.add_argument(
        help="Config file to fill the invoice out with",
        type=pathlib.Path,
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
        help="Output .tex path where to generate the auxiliary/tex/pdf files. Use SAME to make the same as the config file name",
        type=pathlib.Path,
        dest="out_path",
        default="SAME",
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
        "./out/"
        + path.extsep.join(path.split(prog_args.cfg)[1].split(path.extsep)[:-1])
        + (
            ".tex"
            if str(prog_args.out_path) == "SAME"
            else (
                prog_args.out_path
                if prog_args.out_path is not None and str(prog_args.out_path) != ""
                else "./out/quote.tex" if prog_args.quote else "./out/invoice.tex"
            )
        )
    )
    template = (
        prog_args.template
        if prog_args.template is not None
        else "./quote_template.tex" if prog_args.quote else "./invoice_template.tex"
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
            "-f",
            f"-aux-directory={out_dir}",
            f"-output-directory={out_dir}",
            out_path,
        ],
    ).wait()
