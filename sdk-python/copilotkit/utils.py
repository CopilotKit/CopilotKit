"""
Utils
"""

import asyncio

async def yield_control():
    """
    Yield control to the event loop.
    """
    loop = asyncio.get_running_loop()
    future = loop.create_future()
    loop.call_soon(future.set_result, None)
    await future
