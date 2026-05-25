"""Export the live FastAPI OpenAPI spec to docs/.

Run:
    python -m app.scripts.export_openapi

Or via Make: `make backend-openapi`. CI also runs this with --check to
fail when the committed file drifts from the running app.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import yaml

from app.main import app

DEFAULT_OUT = (
    Path(__file__).resolve().parents[3]
    / "docs"
    / "technical"
    / "03_api_specification.generated.yaml"
)


def _spec_yaml() -> str:
    # Round-trip via JSON so Pydantic types serialize the same way FastAPI does.
    raw = json.loads(json.dumps(app.openapi(), sort_keys=True))
    return yaml.safe_dump(raw, sort_keys=True, allow_unicode=True, width=120)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument(
        "--check",
        action="store_true",
        help="exit non-zero if the file on disk is out of date",
    )
    args = parser.parse_args()

    generated = _spec_yaml()
    args.out.parent.mkdir(parents=True, exist_ok=True)

    if args.check:
        if not args.out.exists():
            print(f"::error::{args.out} is missing — run app.scripts.export_openapi")
            return 1
        on_disk = args.out.read_text(encoding="utf-8")
        if on_disk != generated:
            print(f"::error::{args.out} is out of date — run app.scripts.export_openapi")
            return 1
        print(f"✔ {args.out} is up to date ({len(generated)} bytes)")
        return 0

    args.out.write_text(generated, encoding="utf-8")
    print(f"✔ wrote {args.out} ({len(generated)} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
