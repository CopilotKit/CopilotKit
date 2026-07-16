import ast
import unittest
from pathlib import Path
from typing import Optional


AGENT_SOURCE = Path(__file__).resolve().parents[1] / "src" / "agent.py"


def _literal_or_name(node: ast.AST) -> Optional[str]:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.Name):
        return node.id
    return None


class GraphTopologyTest(unittest.TestCase):
    def test_chat_node_has_declared_termination_edge(self) -> None:
        tree = ast.parse(AGENT_SOURCE.read_text())
        edges: set[tuple[Optional[str], Optional[str]]] = set()

        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            if not isinstance(node.func, ast.Attribute):
                continue
            if node.func.attr != "add_edge" or len(node.args) < 2:
                continue

            edges.add((_literal_or_name(node.args[0]), _literal_or_name(node.args[1])))

        self.assertIn(("chat_node", "END"), edges)


if __name__ == "__main__":
    unittest.main()
