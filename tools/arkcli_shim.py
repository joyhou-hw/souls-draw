import os
import subprocess
import sys


def entry():
    p = os.path.join(
        os.environ.get("APPDATA", ""),
        "npm",
        "node_modules",
        "@volcengine",
        "ark-cli",
        "scripts",
        "run.js",
    )
    if not os.path.exists(p):
        raise FileNotFoundError(f"arkcli run.js not found: {p}")
    return p


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
    argv = ["node", entry()] + sys.argv[1:]
    r = subprocess.run(
        argv,
        env=clean_env(),
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    sys.exit(r.returncode)


if __name__ == "__main__":
    main()