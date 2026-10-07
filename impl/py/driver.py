import sys

import heat


def main():
    data = sys.stdin.buffer.read().decode("utf-8", errors="replace")
    out = []
    for line in data.split("\n"):
        if not line.strip():
            continue
        try:
            out.append(heat.dumps(heat.handle(line)))
        except Exception:
            out.append('{"id":null,"error":"bad_request"}')
    sys.stdout.buffer.write(("".join(l + "\n" for l in out)).encode("utf-8"))
    sys.stdout.buffer.flush()


if __name__ == "__main__":
    main()
