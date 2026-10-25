"""Build a runtime-only derivative; compare isolated modules before publishing."""
import argparse
import json
import pathlib
import re
import subprocess

ROOT = pathlib.Path(__file__).parent
FIXED = 'v22.23.4'


def command(args, timeout=900, check=True):
    result = subprocess.run(args, text=True, capture_output=True, timeout=timeout, check=False)
    if check and result.returncode:
        raise RuntimeError(f'{args[0:3]} exited {result.returncode}: {result.stderr[-3000:]}')
    return result


def validate(row):
    assert re.fullmatch(r'[a-z0-9-]+', row['name'])
    assert re.fullmatch(r'ghcr.io/copilotkit/[a-z0-9-]+@sha256:[0-9a-f]{64}', row['base'])
    assert row['nodePath'] in ['/usr/bin/node', '/usr/local/bin/node']
    assert re.fullmatch(r'node:22\.23\.4-(bookworm-slim|alpine3\.24)@sha256:[0-9a-f]{64}', row['donor'])
    assert re.fullmatch(r'ghcr.io/copilotkit/[a-z0-9-]+:node-security-staging-20261024-[0-9a-f]{12}', row['target'])
    assert row['base'].split('@')[0] == row['target'].split(':node-security-')[0]
    assert row['oldNode'].startswith(('v20.', 'v22.')) and row['oldNode'] != FIXED
    for path in row['addons']:
        assert path.startswith('/app/') and path.endswith('.node') and '\n' not in path


def inspect(ref):
    return json.loads(command(['docker', 'image', 'inspect', ref]).stdout)[0]


def sandbox(ref, path, source, args=()):
    return command([
        'docker', 'run', '--rm', '--network', 'none', '--read-only',
        '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
        '--pids-limit', '64', '--memory', '1g', '--cpus', '2',
        '--entrypoint', path, ref, '-e', source, *args,
    ], timeout=45)


RUNTIME = """
const assert=require('node:assert/strict');
const c=require('node:crypto'),z=require('node:zlib');
assert.equal(c.createHash('sha256').update('abc').digest('hex'),
'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
assert.equal(z.gunzipSync(z.gzipSync('runtime-check')).toString(),'runtime-check');
console.log(JSON.stringify({node:process.version,arch:process.arch,abi:process.versions.modules,napi:process.versions.napi}));
"""
ADDON = """
try{require(process.argv[1]);console.log(JSON.stringify({ok:true}));}
catch(e){console.log(JSON.stringify({ok:false,code:e.code||'',message:e.message}));}
"""


def compatible_addons(paths, musl):
    # Retain compatible CPU Linux/x64 addons, not foreign optional backends.
    for path in paths:
        lower = path.lower()
        if any(x in lower for x in ['darwin', 'win32', 'arm64', 'armv7', 'cuda', 'vulkan', 'ripgrep']):
            continue
        if ('musl' in lower) != musl:
            continue
        yield path


def compare_config(base, candidate):
    assert base['Architecture'] == candidate['Architecture'] == 'amd64'
    assert candidate['RootFS']['Layers'][:-1] == base['RootFS']['Layers']
    # Every application and dependency layer is inherited without modification.
    bconfig, cconfig = dict(base['Config']), dict(candidate['Config'])
    blabels, clabels = bconfig.pop('Labels') or {}, cconfig.pop('Labels') or {}
    assert clabels == {**blabels, 'ai.copilotkit.node-security-runtime': '22.23.4'}
    assert bconfig == cconfig, 'Entrypoint/CMD/environment/user/workdir/config drift'


def publish(row):
    validate(row)
    out = pathlib.Path('node-security-receipt.json')
    receipt = {'service': row['name'], 'base': row['base'], 'target': row['target'],
               'status': 'PREPARING', 'nodePath': row['nodePath'], 'addons': []}
    def save():
        out.write_text(json.dumps(receipt, indent=2) + '\n')
    save()
    try:
        exists = command(['docker', 'buildx', 'imagetools', 'inspect', row['target']], check=False)
        if exists.returncode == 0:
            raise RuntimeError('Unique target already exists; refusing overwrite')
        # An arbitrary registry failure cannot be mistaken for a missing tag.
        assert any(x in exists.stderr.lower() for x in ['not found', 'manifest unknown']), exists.stderr
        command(['docker', 'pull', '--platform', 'linux/amd64', row['base']])
        command(['docker', 'build', '--platform', 'linux/amd64', '--pull', '--no-cache',
                 '--build-arg', 'BASE=' + row['base'], '--build-arg', 'DONOR=' + row['donor'],
                 '--build-arg', 'NODE_PATH=' + row['nodePath'], '-f', str(ROOT / 'runtime.Dockerfile'),
                 '-t', row['target'], str(ROOT)])
        compare_config(inspect(row['base']), inspect(row['target']))
        before = json.loads(sandbox(row['base'], row['nodePath'], RUNTIME).stdout)
        after = json.loads(sandbox(row['target'], row['nodePath'], RUNTIME).stdout)
        assert before['node'] == row['oldNode'] and after['node'] == FIXED
        assert before['arch'] == after['arch'] == 'x64'
        receipt.update(runtimeBefore=before, runtimeAfter=after, applicationLayersUnchanged=True,
                       launchConfigUnchanged=True)
        for path in compatible_addons(row['addons'], 'alpine' in row['donor']):
            b = json.loads(sandbox(row['base'], row['nodePath'], ADDON, [path]).stdout)
            c = json.loads(sandbox(row['target'], row['nodePath'], ADDON, [path]).stdout)
            receipt['addons'].append({'path': path, 'before': b, 'after': c})
            save()
            assert b == c, 'Native-addon behavior changed: ' + path
        if row['addons']:
            assert any(x['before']['ok'] for x in receipt['addons']), 'No working native addon established'
        receipt['status'] = 'ISOLATED_COMPARISON_PASS'
        save()
        exists = command(['docker', 'buildx', 'imagetools', 'inspect', row['target']], check=False)
        assert exists.returncode != 0 and any(
            x in exists.stderr.lower() for x in ['not found', 'manifest unknown']
        ), 'Target exists or absence cannot be established immediately before publication'
        receipt['status'] = 'PUBLICATION_STARTED'
        save()
        pushed = command(['docker', 'push', row['target']])
        match = re.search(r'digest: (sha256:[0-9a-f]{64})', pushed.stdout)
        assert match, 'Push did not report an immutable digest'
        pushed_digest = match.group(1)
        digest = command(['docker', 'buildx', 'imagetools', 'inspect', row['target'],
                          '--format', '{{json .Manifest.Digest}}']).stdout.strip()
        digest = json.loads(digest)
        assert re.fullmatch(r'sha256:[0-9a-f]{64}', digest)
        assert digest == pushed_digest, 'Registry tag no longer matches this push'
        receipt.update(status='PUBLISHED', digest=digest,
                       immutableRef=row['target'].split(':node-security-')[0] + '@' + digest)
        save()
    except Exception as exc:
        uncertain = receipt['status'] == 'PUBLICATION_STARTED'
        receipt.update(status='PUBLICATION_OUTCOME_UNKNOWN' if uncertain else 'BLOCKED', error=str(exc))
        save()
        raise


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('service')
    options = parser.parse_args()
    rows = json.loads((ROOT / 'manifest.json').read_text())
    publish(next(row for row in rows if row['name'] == options.service))
