"""Dice-rolling tool implementation."""

import random
from typing import Any


def roll_dice_impl(sides: int) -> dict[str, Any]:
    """Roll a die with the given number of sides.

    Returns a dict with the requested ``sides`` and the rolled ``result``
    (a random integer in ``[1, sides]``).
    """
    return {"sides": sides, "result": random.randint(1, sides)}
