import re
import argparse
import pathlib
from os import path, makedirs
from subprocess import Popen
from configparser import ConfigParser


class ContextVariables:
    IMPORT_SEPARATOR = "\n"

    def __init__(self, base_path):
        self.base_path = base_path

        self.config = ConfigParser()

        self.fetch_imports()
        self.build_invoice_items()

    def fetch_imports(self):
        import_queue = [path.realpath(self.base_path)]
        seen_imports = set(import_queue)
        errored_imports = set()
        while len(import_queue) > 0:
            import_path = import_queue.pop(0)
            new_config = ConfigParser()
            success = new_config.read(import_path)
            if not success:
                errored_imports.add(import_path)
                continue
            for section in new_config.sections():
                if section not in self.config:
                    self.config.add_section(section)
                for option in new_config.options(section):
                    self.config.set(section, option, new_config.get(section, option))
            new_imports = set(
                path.realpath(path.join(path.dirname(import_path), new_import + ".cfg"))
                if new_import.startswith(".")
                else path.abspath(new_import + ".cfg")
                for new_import in self.config.get("META", "import", fallback="").split(
                    self.IMPORT_SEPARATOR
                )
                if new_import
            )
            self.config.set("META", "import", "")
            for new_import in new_imports:
                if new_import not in seen_imports:
                    seen_imports.add(new_import)
                    import_queue.append(new_import)
        if errored_imports:
            raise ImportError(
                "Could not import the following config files:\n"
                + "\n".join(errored_imports)
            )

    def build_invoice_items(self):
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
        for item, section in zip(self.invoice_items, item_sections):
            if "id" not in item:
                item["id"] = section[len(item_prefix) :]
            if "." in item["hrs"]:
                item["hrs"] = f"{float(item['hrs']):.2f}"
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
        if "total_due" not in self.config["META"]:
            self.config.set("META", "total_due", f"{total:.2f}")

    def get_variable(self, var_id, extra={}):
        var_path = tuple(var_id.split("."))
        if len(var_path) > 1:
            section, key = var_path
        else:
            section, key = "META", var_path[0]
        value = self.config.get(section, key, fallback=None)
        if value is None:
            return extra.get(section, {}).get(key)
        return value


class DynamicContentParser:
    context_variable_re = r"{{\s*(?P<var_id>[\w\.]+)\s*}}"
    directive_re = r"{\*(?P<directive>[^\*]+)\*}"

    def __init__(self, context_variables):
        self.context_variables = context_variables

    def insert_variable(self, match, extra={}):
        variable = self.context_variables.get_variable(
            match.group("var_id"), extra=extra
        )
        return variable if variable is not None else ""

    def directive_items(self, args):
        item_template = args.strip()
        items_string = ""
        if not path.exists(item_template):
            return None
        with open(item_template, "r") as file_handle:
            template_contents = file_handle.read()
            for item in self.context_variables.invoice_items:
                items_string += re.sub(
                    self.context_variable_re,
                    lambda match, item=item: self.insert_variable(
                        match, extra={"ITEM": item}
                    ),
                    template_contents,
                )
        return items_string

    def insert_directive(self, match):
        name = match.group("directive").split()[0]
        args = match.group("directive").strip()[len(name) :].strip()
        directive_name = f"directive_{name}"
        if hasattr(self, directive_name):
            output = getattr(self, directive_name)(args)
            if output is not None:
                return output
        return match.group(0)

    def parse_string(self, contents):
        return re.sub(
            self.context_variable_re,
            self.insert_variable,
            re.sub(self.directive_re, self.insert_directive, contents),
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
        default="./invoice_template.tex",
        dest="template",
    )
    arg_parser.add_argument(
        "--out-path",
        "-o",
        help="Output .tex path where to generate the auxiliary/tex/pdf files",
        type=pathlib.Path,
        default="./out/invoice.tex",
        dest="out_path",
    )
    prog_args = arg_parser.parse_args()

    context_variables = ContextVariables(prog_args.cfg)
    parser = DynamicContentParser(context_variables)
    out_dir = path.dirname(prog_args.out_path)
    makedirs(out_dir, exist_ok=True)

    with open(prog_args.template, "r") as file_handle:
        generated_invoice = parser.parse_string(file_handle.read())

    with open(prog_args.out_path, "w") as file_handle:
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
            prog_args.out_path,
        ],
    ).wait()
