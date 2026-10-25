"""Guard the deployment-image preservation and scope boundaries."""
import copy
import importlib.util
import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).parent
SPEC = importlib.util.spec_from_file_location('publisher', ROOT / 'publish.py')
publisher = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(publisher)


class PublisherGuards(unittest.TestCase):
    def setUp(self):
        self.row = json.loads((ROOT / 'manifest.json').read_text())[0]
        self.base = {'Architecture': 'amd64', 'RootFS': {'Layers': ['app', 'deps']},
                     'Config': {'Entrypoint': ['node', 'server.js'], 'Env': ['PORT=3000'], 'Labels': None}}
        self.candidate = copy.deepcopy(self.base)
        self.candidate['RootFS']['Layers'].append('node-only')
        self.candidate['Config']['Labels'] = {'ai.copilotkit.node-security-runtime': '22.23.4'}

    def test_manifest_is_exact_and_excludes_intelligence_and_patched_services(self):
        rows = json.loads((ROOT / 'manifest.json').read_text())
        self.assertEqual(len(rows), 39)
        self.assertEqual(len({row['name'] for row in rows}), 39)
        for row in rows:
            publisher.validate(row)
            self.assertNotIn('intelligence', row['name'])
            self.assertNotIn(row['name'], ['harness', 'harness-workers', 'pocketbase', 'starter-langgraph-js'])

    def test_mutable_base_and_wrong_repository_are_rejected(self):
        for field, value in [('base', self.row['base'].split('@')[0] + ':latest'),
                             ('target', 'ghcr.io/copilotkit/other:node-security-staging-20261024-' + 'a' * 12),
                             ('nodePath', '/app/server.js')]:
            row = {**self.row, field: value}
            with self.assertRaises(AssertionError):
                publisher.validate(row)

    def test_exact_layer_inheritance_and_config_preservation(self):
        publisher.compare_config(self.base, self.candidate)
        for change in ['env', 'app-layer', 'extra-layer']:
            candidate = copy.deepcopy(self.candidate)
            if change == 'env':
                candidate['Config']['Env'] = ['PORT=4000']
            elif change == 'app-layer':
                candidate['RootFS']['Layers'][0] = 'modified-app'
            else:
                candidate['RootFS']['Layers'].append('unrelated')
            with self.assertRaises(AssertionError):
                publisher.compare_config(self.base, candidate)

    def test_foreign_optional_native_backends_are_not_loaded(self):
        paths = ['/app/linux-x64-gnu/addon.node', '/app/linux-x64-musl/addon.node',
                 '/app/darwin-arm64/addon.node', '/app/linux-x64-cuda/addon.node',
                 '/app/ripgrep/linux-x64/ripgrep.node']
        self.assertEqual(list(publisher.compatible_addons(paths, False)), paths[:1])
        self.assertEqual(list(publisher.compatible_addons(paths, True)), paths[1:2])


if __name__ == '__main__':
    unittest.main()
