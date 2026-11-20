import argparse
import json
import os
import subprocess
import sys

MODEL = os.environ.get("ARKGEN_MODEL", "doubao-seedream-5.0-flash")


def arkcli_entry():
    run_js = os.path.join(
        os.environ.get("APPDATA", ""),
        "npm",
        "node_modules",
        "@volcengine",
        "ark-cli",
        "scripts",
        "run.js",
    )
    if not os.path.exists(run_js):
        raise FileNotFoundError(f"arkcli run.js not found: {run_js}")
    return run_js


def clean_env():
    env = os.environ.copy()
    for k in (
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "http_proxy",
        "https_proxy",
        "ALL_PROXY",
        "all_proxy",
        "NO_PROXY",
        "no_proxy",
    ):
        env.pop(k, None)
    env.update(
        {
            "ARKCLI_NO_UPDATE_NOTIFIER": "1",
            "ARKCLI_CALLER_TYPE": "ai_agent",
            "ARKCLI_CALLER_NAME": "trae",
            "ARKCLI_SKILL_NAME": "arkcli-gen",
        }
    )
    return env


def main():
    ap = argparse.ArgumentParser(
        description="Invoke arkcli api arkruntime.generate_images with robust arg passing."
    )
    ap.add_argument("params_file", help="JSON file containing the request params")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--out-file", default=None, help="optional path to persist stdout JSON")
    ap.add_argument("--model", default=None, help="override model id")
    args = ap.parse_args()

    with open(args.params_file, encoding="utf-8") as f:
        params = json.load(f)

    if args.model:
        params["model"] = args.model

    argv = [
        "node",
        arkcli_entry(),
        "api",
        "arkruntime.generate_images",
        "--params",
        json.dumps(params, ensure_ascii=False),
        "--format",
        "json",
    ]
    if args.dry_run:
        argv.append("--dry-run")

    r = subprocess.run(
        argv,
        env=clean_env(),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )

    out = (r.stdout or "").strip()
    if out:
        print(out)
    if r.stderr:
        print("STDERR:", r.stderr, file=sys.stderr)

    if args.out_file and out:
        with open(args.out_file, "w", encoding="utf-8") as f:
            f.write(out + "\n")

    sys.exit(r.returncode)


if __name__ == "__main__":
    main()