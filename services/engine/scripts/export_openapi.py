"""Export the deterministic OpenAPI schema from FastAPI to packages/contracts/openapi.json."""

import json
from pathlib import Path

from engine.main import create_app


def main() -> None:
    app = create_app()
    schema = app.openapi()
    repo_root = Path(__file__).resolve().parents[3]
    out_path = repo_root / "packages" / "contracts" / "openapi.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    formatted = json.dumps(schema, indent=2, sort_keys=True) + "\n"
    out_path.write_text(formatted, encoding="utf-8")
    print(f"Exported OpenAPI schema to {out_path}")


if __name__ == "__main__":
    main()

