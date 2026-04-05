#!/usr/bin/env python3
"""
Canary tests for The Collective
Runs post-deploy to verify all systems are operational.
"""

import argparse
import sys
import json
import time
import urllib.request
import urllib.error
import subprocess


PASS = "\033[92m[PASS]\033[0m"
FAIL = "\033[91m[FAIL]\033[0m"
SKIP = "\033[93m[SKIP]\033[0m"

results = []


def test(name, fn):
    try:
        fn()
        print(f"{PASS} {name}")
        results.append((name, True, None))
    except Exception as e:
        print(f"{FAIL} {name}: {e}")
        results.append((name, False, str(e)))


def http_get(url, timeout=10):
    req = urllib.request.Request(url, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def http_post(url, data, timeout=30):
    body = json.dumps(data).encode()
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def main():
    parser = argparse.ArgumentParser(description="Collective canary tests")
    parser.add_argument("--collective-host", default="http://localhost:18789")
    parser.add_argument("--ollama-host", default="http://ollama.csdyn.com:11434")
    parser.add_argument("--neo4j-bolt", default="bolt://localhost:7687")
    parser.add_argument("--skip-one", action="store_true", help="Skip One (Claude Code) test")
    args = parser.parse_args()

    print(f"\n{'='*50}")
    print("  The Collective — Canary Test Suite")
    print(f"{'='*50}\n")

    # ── Ollama connectivity ──────────────────────────────
    def test_ollama_up():
        data = http_get(f"{args.ollama_host}/api/tags", timeout=5)
        assert "models" in data, "No models key in response"

    test("Ollama: API reachable", test_ollama_up)

    def test_ollama_hermes():
        data = http_get(f"{args.ollama_host}/api/tags")
        models = [m["name"] for m in data.get("models", [])]
        assert any("hermes2pro" in m for m in models), f"hermes2pro not found. Available: {models}"

    test("Ollama: hermes2pro available", test_ollama_hermes)

    def test_ollama_llama3():
        data = http_get(f"{args.ollama_host}/api/tags")
        models = [m["name"] for m in data.get("models", [])]
        assert any("llama3-10k" in m or "llama3" in m for m in models), f"llama3 not found. Available: {models}"

    test("Ollama: llama3-10k available", test_ollama_llama3)

    def test_ollama_coder():
        data = http_get(f"{args.ollama_host}/api/tags")
        models = [m["name"] for m in data.get("models", [])]
        assert any("qwen2.5-coder" in m for m in models), f"qwen2.5-coder not found. Available: {models}"

    test("Ollama: qwen2.5-coder:14b available", test_ollama_coder)

    def test_ollama_embed():
        data = http_get(f"{args.ollama_host}/api/tags")
        models = [m["name"] for m in data.get("models", [])]
        assert any("nomic-embed" in m for m in models), f"nomic-embed-text not found. Available: {models}"

    test("Ollama: nomic-embed-text available", test_ollama_embed)

    def test_hermes_inference():
        result = http_post(
            f"{args.ollama_host}/api/chat",
            {
                "model": "hermes2pro",
                "messages": [{"role": "user", "content": "Reply with exactly: ONLINE"}],
                "stream": False,
                "options": {"num_predict": 5}
            },
            timeout=60
        )
        content = result.get("message", {}).get("content", "")
        assert content.strip(), "Empty response from hermes2pro"

    test("Ollama: hermes2pro inference (Locutus/Hugh)", test_hermes_inference)

    # ── Neo4j ────────────────────────────────────────────
    def test_neo4j_bolt():
        try:
            import neo4j
        except ImportError:
            # Try via cypher-shell instead
            result = subprocess.run(
                ["cypher-shell", "-u", "neo4j", "-a", args.neo4j_bolt,
                 "RETURN 'ONLINE' as status"],
                capture_output=True, text=True, timeout=10
            )
            assert result.returncode == 0, f"cypher-shell failed: {result.stderr}"
            return
        uri = args.neo4j_bolt
        neo4j_host = uri.replace("bolt://", "").split(":")[0]
        port = int(uri.split(":")[-1]) if ":" in uri.split("//")[-1] else 7687
        import socket
        s = socket.socket()
        s.settimeout(5)
        s.connect((neo4j_host, port))
        s.close()

    test("Neo4j: bolt port reachable", test_neo4j_bolt)

    def test_neo4j_collective_seed():
        result = subprocess.run(
            ["cypher-shell", "-u", "neo4j", "-a", args.neo4j_bolt,
             "MATCH (n:Entity {name: 'The Collective'}) RETURN count(n) as c"],
            capture_output=True, text=True, timeout=10
        )
        assert "1" in result.stdout, f"Collective seed not found: {result.stdout}"

    test("Neo4j: Collective seed data present", test_neo4j_collective_seed)

    # ── OpenClaw ─────────────────────────────────────────
    def test_openclaw_running():
        result = subprocess.run(
            ["openclaw", "status"],
            capture_output=True, text=True, timeout=10
        )
        assert "running" in result.stdout.lower() or result.returncode == 0, \
            f"OpenClaw not running: {result.stdout}"

    test("OpenClaw: daemon running", test_openclaw_running)

    def test_openclaw_agents():
        result = subprocess.run(
            ["openclaw", "agents", "list"],
            capture_output=True, text=True, timeout=10
        )
        for agent in ["locutus", "seven", "data", "hugh"]:
            assert agent in result.stdout.lower(), f"Agent {agent} not found in: {result.stdout}"

    test("OpenClaw: all drones registered", test_openclaw_agents)

    # ── One (Claude Code) ─────────────────────────────────
    if not args.skip_one:
        def test_one_reachable():
            result = subprocess.run(
                ["ssh", "-o", "ConnectTimeout=5", "-o", "BatchMode=yes",
                 "root@claude.csdyn.com", "claude --version"],
                capture_output=True, text=True, timeout=10
            )
            assert result.returncode == 0, f"Cannot reach claude.csdyn.com: {result.stderr}"

        test("One: claude.csdyn.com reachable via SSH", test_one_reachable)

        def test_one_invocation():
            result = subprocess.run(
                ["ssh", "-o", "ConnectTimeout=10", "root@claude.csdyn.com",
                 "claude -p 'Reply with exactly: ASSIMILATED'"],
                capture_output=True, text=True, timeout=60
            )
            assert result.returncode == 0, f"One invocation failed: {result.stderr}"
            assert result.stdout.strip(), "One returned empty response"

        test("One: Claude Code headless invocation", test_one_invocation)
    else:
        print(f"{SKIP} One: skipped (--skip-one)")

    # ── Summary ───────────────────────────────────────────
    passed = sum(1 for _, ok, _ in results if ok)
    total = len(results)
    failed = [(n, e) for n, ok, e in results if not ok]

    print(f"\n{'='*50}")
    print(f"  Results: {passed}/{total} passed")
    if failed:
        print(f"\n  Failed tests:")
        for name, err in failed:
            print(f"    - {name}: {err}")
    print(f"{'='*50}\n")

    sys.exit(0 if not failed else 1)


if __name__ == "__main__":
    main()
