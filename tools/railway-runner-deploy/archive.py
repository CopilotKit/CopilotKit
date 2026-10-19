"""Read bounded artifact files as data, without extracting paths or running code."""

import base64
import json
import stat
import sys
import zipfile

allowed = {
    "runner-identity.json",
    "runner-source.json",
    "image-candidates.json",
    "application-source.json",
    "strands-source.json",
    "deployment-receipt.json",
}
try:
    result = {}
    total = 0
    with zipfile.ZipFile(sys.argv[1]) as archive:
        members = archive.infolist()
        assert 0 < len(members) <= 16
        for member in members:
            assert member.filename in allowed and member.filename not in result
            assert not member.is_dir() and not member.flag_bits & 1
            assert stat.S_IFMT(member.external_attr >> 16) in (0, stat.S_IFREG)
            assert 0 <= member.file_size <= 4 * 1024 * 1024
            assert member.file_size <= max(member.compress_size, 1) * 200
            total += member.file_size
            assert total <= 16 * 1024 * 1024
            with archive.open(member) as source:
                data = source.read(4 * 1024 * 1024 + 1)
            assert len(data) == member.file_size
            result[member.filename] = base64.b64encode(data).decode("ascii")
    print(json.dumps(result))
except Exception:
    print("Artifact archive refused", file=sys.stderr)
    sys.exit(1)
