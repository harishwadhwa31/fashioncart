"""
Measure which tool the model actually picks for a realistic shopper prompt.

Why this exists: tool selection is the last unverified thing in the build. It only manifests in
a live conversation, so the alternative is guessing at descriptions and waiting for a demo to
expose the gap. This closes the loop without needing a human in a chat window.

How it works: pulls the REAL tool definitions from the deployed connector via tools/list, hands
them to the Messages API exactly as a host would, sends one shopper utterance, and records which
tool came back. No conversation, no widget, one turn each.

What it is and is not:
  - it IS a genuine measurement of selection given these descriptions and this schema
  - it is NOT claude.ai. The product surface adds its own system prompt and a tool_search step,
    so treat a pass here as necessary, not sufficient. A FAILURE here is real either way: if the
    model cannot pick correctly with the tools directly in front of it, it will not do better
    with more context competing for attention.

Costs money. Run only with explicit authorisation:
    python scripts/eval_tool_selection.py --run
Default is a dry run that prices the job and calls nothing billable.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENV_CANDIDATES = [ROOT / ".env"]

MCP_URL = os.environ.get("FC_MCP_URL", "http://localhost:3001/mcp")  # point at a deployment to test what is live
MODEL = "claude-sonnet-5"

# Each case: what a shopper says, and which tool SHOULD be chosen.
# `context` seeds the turn where a tool legitimately needs prior state (a cart id, a product id),
# because judging add-to-cart on a cold conversation would test the wrong thing.
CASES: list[dict] = [
    # --- the default path. If any of these miss, the demo is fragile. ---
    {"say": "Show me some kurtas", "want": "search-products"},
    {"say": "Find me cotton kurtas under 2000 rupees, delivering to 400013", "want": "search-products"},
    {"say": "What do you have in linen?", "want": "search-products"},
    {"say": "I need an outfit for a wedding", "want": "search-products"},
    {"say": "Do you sell shoes?", "want": "search-products"},
    {"say": "Something under 1500", "want": "search-products"},
    {"say": "Show me what's on sale", "want": "search-products"},
    {"say": "I'm looking for a shirt for the office", "want": "search-products"},

    # --- single product, given an id already in context ---
    {"say": "Tell me more about that kurta", "want": "get-product-details",
     "context": "I searched and you showed me FC-KUR-003, the Block-Print Anarkali Kurta."},
    {"say": "What fabric is FC-SHT-001 made of?", "want": "get-product-details"},

    # --- cart ---
    {"say": "Add two of those in medium", "want": "add-to-cart",
     "context": "You showed me FC-KUR-003, the Block-Print Anarkali Kurta, available in S M L."},
    {"say": "I'll take the medium", "want": "add-to-cart",
     "context": "You showed me FC-SHT-001, the Oxford Button-Down Shirt, available in S M L XL."},
    {"say": "Make that three instead", "want": "set-quantity",
     "context": "My cart is cart_abc123 and it has 2 of FC-KUR-003 in size M."},
    {"say": "Actually remove the shirt", "want": "remove-from-cart",
     "context": "My cart is cart_abc123 and it has FC-SHT-001 in size M and FC-KUR-003 in size L."},
    {"say": "What's in my bag?", "want": "get-cart", "context": "My cart is cart_abc123."},
    {"say": "How much is that altogether?", "want": "get-cart", "context": "My cart is cart_abc123."},

    # --- checkout ---
    {"say": "I'm ready to check out", "want": "checkout", "context": "My cart is cart_abc123."},
    {"say": "Let's buy this", "want": "checkout", "context": "My cart is cart_abc123."},

    # --- diagnostics must NOT capture shopping intent ---
    {"say": "Run FashionCart diagnostics", "want": "run-diagnostics"},
    {"say": "Is the FashionCart connector working?", "want": "run-diagnostics"},

    # --- traps: plausible phrasings that could pull the wrong tool ---
    {"say": "Check what kurtas you have", "want": "search-products"},          # "check" -> diagnostics?
    {"say": "Test out a few shirts for me", "want": "search-products"},        # "test" -> diagnostics?
    {"say": "Show me my order total", "want": "get-cart", "context": "My cart is cart_abc123."},
    {"say": "Take one off", "want": "set-quantity",
     "context": "My cart is cart_abc123 and it has 3 of FC-KUR-003 in size M."},
]

SYSTEM = (
    "You are a shopping assistant with access to the FashionCart connector. "
    "Use its tools to help the shopper. Prefer calling a tool over answering from memory."
)


def load_key() -> str:
    if os.environ.get("ANTHROPIC_API_KEY"):
        return os.environ["ANTHROPIC_API_KEY"]
    for env in ENV_CANDIDATES:
        if not env.exists():
            continue
        for line in env.read_text(encoding="utf-8").splitlines():
            if line.strip().startswith("ANTHROPIC_API_KEY"):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("ANTHROPIC_API_KEY not found")


def fetch_tools() -> list[dict]:
    """Pull the live tool definitions, so the eval tests what is actually deployed."""
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}).encode()
    req = urllib.request.Request(
        MCP_URL,
        data=body,
        headers={"Content-Type": "application/json", "Accept": "application/json, text/event-stream"},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        raw = resp.read().decode("utf-8")
    for line in raw.splitlines():
        if line.startswith("data: "):
            payload = json.loads(line[6:])
            return payload["result"]["tools"]
    raise SystemExit("no data frame in tools/list response")


def to_anthropic_tools(mcp_tools: list[dict]) -> list[dict]:
    out = []
    for t in mcp_tools:
        out.append(
            {
                "name": t["name"],
                "description": t.get("description", ""),
                "input_schema": t.get("inputSchema") or {"type": "object", "properties": {}},
            }
        )
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", action="store_true", help="Actually call the API. Costs money.")
    args = ap.parse_args()

    mcp_tools = fetch_tools()
    tools = to_anthropic_tools(mcp_tools)
    print(f"live tools: {len(tools)} -> {', '.join(t['name'] for t in tools)}")
    print(f"cases: {len(CASES)}\n")

    import anthropic

    client = anthropic.Anthropic(api_key=load_key())

    if not args.run:
        # count_tokens is free. Use it to price the paid run exactly rather than guess.
        total_in = 0
        for c in CASES:
            msgs = []
            if c.get("context"):
                msgs.append({"role": "user", "content": c["context"]})
                msgs.append({"role": "assistant", "content": "Understood."})
            msgs.append({"role": "user", "content": c["say"]})
            r = client.messages.count_tokens(model=MODEL, system=SYSTEM, tools=tools, messages=msgs)
            total_in += r.input_tokens
        print("DRY RUN, nothing billable was called.")
        print(f"  model            : {MODEL}")
        print(f"  requests         : {len(CASES)}")
        print(f"  input tokens     : {total_in:,}  (measured with the free count_tokens endpoint)")
        print(f"  output tokens    : ~{len(CASES) * 60:,} (one tool_use block each, max_tokens 256)")
        print("\n  Re-run with --run to execute.")
        return

    correct = 0
    failures: list[tuple[str, str, str]] = []
    print(f"{'want':<20} {'got':<20} {'prompt'}")
    print("-" * 92)
    for c in CASES:
        msgs = []
        if c.get("context"):
            msgs.append({"role": "user", "content": c["context"]})
            msgs.append({"role": "assistant", "content": "Understood."})
        msgs.append({"role": "user", "content": c["say"]})

        resp = client.messages.create(
            model=MODEL, max_tokens=256, system=SYSTEM, tools=tools, messages=msgs
        )
        picked = next((b.name for b in resp.content if b.type == "tool_use"), "(no tool call)")
        ok = picked == c["want"]
        correct += ok
        if not ok:
            failures.append((c["say"], c["want"], picked))
        print(f"{c['want']:<20} {picked:<20} {'' if ok else 'MISS  '}{c['say'][:44]}")

    print("-" * 92)
    print(f"\n{correct}/{len(CASES)} correct ({100 * correct / len(CASES):.0f}%)")
    if failures:
        print("\nMISSES, each one a description problem:")
        for say, want, got in failures:
            print(f'  "{say}"\n     wanted {want}, got {got}')


if __name__ == "__main__":
    main()
