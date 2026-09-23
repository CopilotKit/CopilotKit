"""Load every langgraph.json graph the way langgraph-api does (file path spec,
random module name, config dependencies on sys.path) and draw its structure."""

import importlib.util, json, random, string, sys, time, traceback

cfg = json.load(open("langgraph.json"))
for dep in cfg.get("dependencies", []):
    sys.path.insert(0, dep)
ok = fail = 0
for gid, spec in cfg["graphs"].items():
    path, var = spec.rsplit(":", 1)
    t = time.time()
    try:
        name = "".join(random.choice(string.ascii_letters) for _ in range(24))
        s = importlib.util.spec_from_file_location(name, path)
        m = importlib.util.module_from_spec(s)
        sys.modules[name] = m
        s.loader.exec_module(m)
        g = getattr(m, var)
        nodes = list(g.get_graph().nodes)
        print(
            f"OK   {gid:32} {type(g).__name__:18} nodes={len(nodes)} {time.time() - t:.2f}s"
        )
        ok += 1
    except Exception as e:
        print(f"FAIL {gid:32} {type(e).__name__}: {e}")
        traceback.print_exc()
        fail += 1
print(f"graphs: {ok} ok, {fail} failed, {len(cfg['graphs'])} total")
sys.exit(1 if fail else 0)
