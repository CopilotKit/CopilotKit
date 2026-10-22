"""Consumer verification of actual portable JSON; no demo adapter or policy import."""

import argparse
import json
from pathlib import Path

from a2ui.core import Catalog, PayloadValidator
from a2ui.inference_formats.express import ExpressFormat

cli = argparse.ArgumentParser(description=__doc__)
cli.add_argument("catalog", type=Path)
args = cli.parse_args()
catalog = Catalog.from_json(
    json.loads(args.catalog.read_text()), protocol_version="v1.0"
)
format = ExpressFormat([catalog], version="v1.0")
parser = format.create_parser()
examples = [
    ('Text("Hello", color="red")', 'Text(text="Hello", color="red")'),
    ('Column([Text("Hello")], gap=4)', 'Column(children=[Text(text="Hello")], gap=4)'),
    ('Button("Save", Event("save"))', 'Button(label="Save", onClick=Event("save"))'),
    ('TextField("Email", $/email)', 'TextField(label="Email", value=$/email)'),
    (
        'Chart([], "month", ["revenue"], chartType="line")',
        'Chart(data=[], xKey="month", series=["revenue"], chartType="line")',
    ),
    (
        'FollowUp(["Next"], title="Continue")',
        'FollowUp(items=["Next"], title="Continue")',
    ),
]


def compile(source):
    return [
        message.model_dump(mode="json", by_alias=True, exclude_unset=True)
        for message in parser.compile("root = " + source, is_final=True)
    ]


for positional, named in examples:
    a, b = compile(positional), compile(named)
    assert a == b, (positional, a, b)
    for operation in a:
        for component in operation.get("createSurface", {}).get("components", []):
            PayloadValidator(catalog).validate_component(component)
    print("PASS", positional)
