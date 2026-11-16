"""Helpers that keep the cached prompt prefix the same between turns."""

from copilotkit.prompt_prefix import drop_in_blocks, prepend_to_newest_user_message


def _history(count: int) -> list[dict]:
    return [
        {"role": "user" if i % 2 == 0 else "assistant", "content": f"m{i}"}
        for i in range(count)
    ]


def test_drop_in_blocks_keeps_the_first_message_until_the_next_block_drop():
    # A window of 20 that grows by one user and one assistant message a turn.
    firsts = [drop_in_blocks(_history(n), 20)[0]["content"] for n in range(21, 41)]

    # A one-message slide changes the first message on every turn. Block drops
    # change it only when a whole block of 10 goes.
    assert len(set(firsts)) <= 3
    assert all(len(drop_in_blocks(_history(n), 20)) <= 20 for n in range(21, 41))
    assert all(len(drop_in_blocks(_history(n), 20)) > 10 for n in range(21, 41))


def test_drop_in_blocks_keeps_the_newest_messages():
    kept = drop_in_blocks(_history(25), 20)

    assert kept[-1]["content"] == "m24"


def test_drop_in_blocks_does_nothing_under_the_limit():
    history = _history(5)

    assert drop_in_blocks(history, 20) is history


def test_prepend_puts_the_note_in_the_newest_user_message_only():
    history = _history(4)

    placed = prepend_to_newest_user_message(history, "Current inputs: {}")

    assert placed[2]["content"] == "Current inputs: {}\n\nm2"
    assert placed[0]["content"] == "m0"
    assert history[2]["content"] == "m2"


def test_prepend_adds_a_text_part_to_multipart_content():
    placed = prepend_to_newest_user_message(
        [{"role": "user", "content": [{"type": "text", "text": "hi"}]}], "Note"
    )

    assert placed[0]["content"][0] == {"type": "text", "text": "Note\n\n"}


def test_prepend_returns_none_without_a_user_message():
    assert (
        prepend_to_newest_user_message([{"role": "assistant", "content": "x"}], "Note")
        is None
    )


def test_drop_in_blocks_does_not_start_with_an_orphaned_tool_result():
    # The block cut lands between a tool call and its result.
    history = [
        {"role": "user", "content": "m0"},
        {"role": "assistant", "content": "", "tool_calls": [{"id": "t1"}]},
        {"role": "tool", "tool_call_id": "t1", "content": "r1"},
        {"role": "tool", "tool_call_id": "t1", "content": "r2"},
        *_history(4),
    ]

    kept = drop_in_blocks(history, 6)

    # The cut moves back to the tool call, so its results keep it.
    assert kept == history[1:]


def test_drop_in_blocks_keeps_the_active_tool_exchange():
    # The history ends with more tool results than a block holds.
    history = [
        {"role": "user", "content": "q"},
        {"role": "assistant", "content": "", "tool_calls": [{"id": f"t{i}"} for i in range(6)]},
        *({"role": "tool", "tool_call_id": f"t{i}", "content": "r"} for i in range(6)),
    ]

    kept = drop_in_blocks(history, 6)

    assert kept == history[1:]
