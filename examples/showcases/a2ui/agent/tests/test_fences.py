import json

from ag_ui.core import TextMessageContentEvent, TextMessageEndEvent

from research_desk.fences import FenceRepairer, repair_line


def stream(chunks):
    repairer = FenceRepairer()
    out = []
    for chunk in chunks:
        out += repairer.feed(TextMessageContentEvent(message_id="m", delta=chunk))
    out += repairer.feed(TextMessageEndEvent(message_id="m"))
    return "".join(e.delta for e in out if isinstance(e, TextMessageContentEvent))


def test_a_line_missing_a_brace_is_repaired():
    broken = '{"version":"v1.0","updateComponents":{"surfaceId":"s","components":[{"id":"a","component":"Text","text":{"@call":"formatString","args":{"value":"x"}},{"id":"b","component":"Text","text":"y"}]}}'
    fixed = json.loads(repair_line(broken))
    assert fixed["updateComponents"]["components"][0]["id"] == "a"


def test_prose_streams_untouched_and_fences_come_out_valid():
    reply = [
        "Warming has sped up since 1980.\n\n```a2",
        'ui\n{"version":"v1.0","createSurface":{"surfaceId":"s","components":[{"id":"root",',
        '"component":"Text","text":"hi"}]}\n',
        "```\nThat is the trend.",
    ]
    text = stream(reply)
    assert text.startswith("Warming has sped up since 1980.\n\n```a2ui\n")
    assert text.endswith("```\nThat is the trend.")
    fence_line = text.split("```a2ui\n")[1].split("\n")[0]
    assert json.loads(fence_line)["createSurface"]["surfaceId"] == "s"


def test_prose_without_fences_is_emitted_as_it_arrives():
    repairer = FenceRepairer()
    first = repairer.feed(TextMessageContentEvent(message_id="m", delta="Hello"))
    assert [e.delta for e in first] == ["Hello"]


def test_flattened_function_calls_get_their_args_nested():
    line = '{"version":"v1.0","updateComponents":{"surfaceId":"s","components":[{"id":"t","component":"Text","text":{"@call":"calc","expression":"a * b","a":{"@path":"/a"},"b":2}}]}}'
    text = json.loads(repair_line(line))["updateComponents"]["components"][0]["text"]
    assert text == {
        "@call": "calc",
        "args": {"expression": "a * b", "a": {"@path": "/a"}, "b": 2},
    }


def test_a_valid_line_is_left_byte_for_byte():
    line = '{"version":"v1.0","deleteSurface":{"surfaceId":"s"}}'
    assert repair_line(line) == line


def test_wrapped_events_and_props_move_onto_the_component():
    line = json.dumps(
        {
            "version": "v1.0",
            "updateComponents": {
                "surfaceId": "s",
                "components": [
                    {
                        "id": "form",
                        "component": "Form",
                        "children": ["c"],
                        "events": {"onSubmit": {"event": {"name": "go"}}},
                    },
                    {"id": "t", "type": "Text", "props": {"text": "hi"}},
                ],
            },
        }
    )
    form, text = json.loads(repair_line(line))["updateComponents"]["components"]
    assert form == {
        "id": "form",
        "component": "Form",
        "children": ["c"],
        "onSubmit": {"event": {"name": "go"}},
    }
    assert text == {"id": "t", "component": "Text", "text": "hi"}


def test_a_submit_button_with_its_own_click_event_keeps_it():
    line = json.dumps(
        {
            "version": "v1.0",
            "updateComponents": {
                "surfaceId": "s",
                "components": [
                    {
                        "id": "go",
                        "component": "Button",
                        "label": "Go",
                        "submit": True,
                        "onClick": {"event": {"name": "go"}},
                    },
                    "stray text",
                ],
            },
        }
    )
    components = json.loads(repair_line(line))["updateComponents"]["components"]
    assert components == [
        {
            "id": "go",
            "component": "Button",
            "label": "Go",
            "onClick": {"event": {"name": "go"}},
        }
    ]


def test_table_cells_that_show_components_are_slotted():
    line = json.dumps(
        {
            "version": "v1.0",
            "updateComponents": {
                "surfaceId": "s",
                "components": [
                    {
                        "id": "t",
                        "component": "Table",
                        "columns": ["Program", "Pace"],
                        "rows": [
                            [{"componentId": "jh"}, "2 years"],
                            [{"componentId": "cu"}, "1 year"],
                        ],
                    },
                ],
            },
        }
    )
    table = json.loads(repair_line(line))["updateComponents"]["components"][0]
    assert table["cellComponents"] == ["jh", "cu"]


def test_raw_chart_colors_give_way_to_the_theme():
    line = json.dumps(
        {
            "version": "v1.0",
            "updateComponents": {
                "surfaceId": "s",
                "components": [
                    {
                        "id": "c",
                        "component": "Chart",
                        "series": [
                            {"key": "a", "color": "#e11d48"},
                            {"key": "b", "color": "info"},
                            "c",
                        ],
                    },
                ],
            },
        }
    )
    series = json.loads(repair_line(line))["updateComponents"]["components"][0][
        "series"
    ]
    assert series == [{"key": "a"}, {"key": "b", "color": "info"}, "c"]


def test_components_on_one_line_stream_out_one_at_a_time():
    line = (
        '{"version":"v1.0","updateComponents":{"surfaceId":"s","components":['
        '{"id":"root","component":"Column","children":["t","c"]},'
        '{"id":"t","component":"Title","text":"Life expectancy"},'
        '{"id":"c","component":"Chart","series":[{"name":"World","color":"#ff0000","data":[1,2]}]}'
        "]}}\n"
    )
    repairer = FenceRepairer()
    feed = lambda text: "".join(
        e.delta
        for e in repairer.feed(TextMessageContentEvent(message_id="m", delta=text))
    )
    sent = feed("Here is the view.\n```a2ui\n")
    # Chunk the line by characters, as a model streams it, and note when each
    # component first reaches the client.
    seen_at = {}
    for index in range(0, len(line), 7):
        sent += feed(line[index : index + 7])
        for component_id in ("root", "t", "c"):
            if f'"id": "{component_id}"' in sent and component_id not in seen_at:
                seen_at[component_id] = index
    # each component reaches the client before the model starts the next one
    assert seen_at["root"] < line.index('"id":"t"')
    assert seen_at["t"] < line.index('"id":"c"')
    sent += feed("```\n")
    sent += "".join(
        e.delta
        for e in repairer.feed(TextMessageEndEvent(message_id="m"))
        if isinstance(e, TextMessageContentEvent)
    )
    operation = json.loads(sent.split("```a2ui\n")[1].split("\n")[0])
    components = operation["updateComponents"]["components"]
    assert [c["id"] for c in components] == ["root", "t", "c"]
    # each streamed component is still normalized
    assert "color" not in components[2]["series"][0]


def test_a_streamed_line_with_a_broken_last_component_is_salvaged():
    text = stream(
        [
            "```a2ui\n",
            '{"version":"v1.0","updateComponents":{"surfaceId":"s","components":[',
            '{"id":"a","component":"Text","text":"one"},',
            '{"id":"b","component":"Text","text":"two"\n',
            "```\n",
        ]
    )
    operation = json.loads(text.split("```a2ui\n")[1].split("\n")[0])
    assert [c["id"] for c in operation["updateComponents"]["components"]] == ["a", "b"]


def test_a_data_model_line_waits_until_it_is_complete():
    repairer = FenceRepairer()
    repairer.feed(TextMessageContentEvent(message_id="m", delta="```a2ui\n"))
    partial = repairer.feed(
        TextMessageContentEvent(
            message_id="m",
            delta='{"version":"v1.0","updateDataModel":{"surfaceId":"s","path":"/","value":{"a":1',
        )
    )
    assert "".join(e.delta for e in partial) == ""


def test_a_root_card_draws_no_box_of_its_own():
    line = '{"version":"v1.0","updateComponents":{"surfaceId":"s","components":[{"id":"root","component":"Card","child":"c"},{"id":"inner","component":"Card","child":"x"}]}}'
    components = json.loads(repair_line(line))["updateComponents"]["components"]
    assert components[0]["variant"] == "section"
    assert "variant" not in components[1]
