"""Copy reviewed public contract files into CAF; never reads a peer working tree.

Run deliberately when reviewing a new contract revision, then review the diff.
Requires authenticated GitHub CLI. No application dependencies are installed.
"""
import base64
import hashlib
import json
from pathlib import Path
import subprocess

REVISION = "1db3699e70de37e9d55efb3ff5f750b0f20348a3"
REPOSITORY = "vsmann3/Netloom-Radius"
FILES = (
    "ecaf-event.schema.json",
    "ecaf-event.example.json",
    "ecaf-provisioning.schema.json",
    "ecaf-provisioning.example.json",
)


def main():
    directory = Path(__file__).resolve().parents[1] / "docs/integrations/radius/reference"
    directory.mkdir(parents=True, exist_ok=True)
    entries = []
    # Fetch everything before writing, so a failed request cannot leave a mixed revision.
    fetched = []
    for name in FILES:
        remote = "docs/integrations/" + name
        result = subprocess.run(
            ["gh", "api", f"repos/{REPOSITORY}/contents/{remote}?ref={REVISION}"],
            check=True, capture_output=True,
        )
        data = base64.b64decode(json.loads(result.stdout)["content"])
        json.loads(data)
        fetched.append((name, data))
        entries.append({
            "file": name,
            "sha256": hashlib.sha256(data).hexdigest(),
            "url": f"https://github.com/{REPOSITORY}/blob/{REVISION}/{remote}",
        })
    for name, data in fetched:
        (directory / name).write_bytes(data)
    (directory / "SOURCE.json").write_bytes((json.dumps({
        "repository": REPOSITORY, "commit": REVISION,
        "caf_reviewed_commit": "05dbe819ff52a5fb022965a1113bd94981b2f167",
        "handoff_pr": "https://github.com/vsmann3/caf-portal/pull/5",
        "files": entries,
    }, indent=2) + "\n").encode("utf-8"))
    print(f"Copied {len(fetched)} unchanged reference files from {REPOSITORY}@{REVISION}")


if __name__ == "__main__":
    main()
