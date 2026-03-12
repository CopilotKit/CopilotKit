from agno.tools import tool


@tool(external_execution=True)
def set_theme_color(theme_color: str):
    """
    Change the theme color of the chat.

    Args:
        background: str: The background color to change to.
    """


@tool(external_execution=True)
def add_proverb(proverb: str):
    """
    Add a proverb to the chat.

    Args:
        proverb: str: The proverb to add to the chat.
    """
