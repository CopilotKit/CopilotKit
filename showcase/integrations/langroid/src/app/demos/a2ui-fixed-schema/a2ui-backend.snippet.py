# Docs-only snippet — not imported or run. The shell-docs page at
# `/generative-ui/a2ui/fixed-schema` references the regions
# `backend-schema-json-load` and `backend-render-operations` to teach
# the schema-loading pattern. This file exposes those regions as
# canonical teaching code so the docs render real samples instead of a
# missing-snippet box. The actual demo backend already loads the schema
# and emits operations end-to-end; this sibling just isolates the two
# teaching lines.
#
# Mirrors the convention from `tool-rendering/render-flight-tool.snippet.tsx`.

# @region[backend-render-operations]
# @region[backend-schema-json-load]
from pathlib import Path
import json

_SCHEMAS_DIR = Path(__file__).parent / "a2ui_schemas"


# Stand-in for the real a2ui SDK helpers. In a real backend, import
# `a2ui` from your runtime SDK; the calls below match its shape.
class _A2UI:
    @staticmethod
    def load_schema(path):
        with open(path) as fh:
            return json.load(fh)

    @staticmethod
    def create_surface(*args, **kwargs): ...
    @staticmethod
    def update_components(*args, **kwargs): ...
    @staticmethod
    def update_data_model(*args, **kwargs): ...
    @staticmethod
    def render(*args, **kwargs): ...


a2ui = _A2UI()
SURFACE_ID = "flight-fixed-schema"
CATALOG_ID = "flight-catalog"


# Schemas are JSON so they can be authored and reviewed independently of
# the backend code. `a2ui.load_schema` is just a thin `json.load` wrapper
# that resolves the path against the schemas directory.
FLIGHT_SCHEMA = a2ui.load_schema(_SCHEMAS_DIR / "flight_schema.json")
# @endregion[backend-schema-json-load]


def emit_render_operations(origin: str, destination: str, airline: str, price: float):
    # The a2ui middleware detects the `a2ui_operations` container in this
    # tool result and forwards the ops to the frontend renderer. The
    # frontend catalog resolves component names to local React components.
    return a2ui.render(
        operations=[
            a2ui.create_surface(SURFACE_ID, catalog_id=CATALOG_ID),
            a2ui.update_components(SURFACE_ID, FLIGHT_SCHEMA),
            a2ui.update_data_model(
                SURFACE_ID,
                {
                    "origin": origin,
                    "destination": destination,
                    "airline": airline,
                    "price": price,
                },
            ),
        ],
    )
    # @endregion[backend-render-operations]
