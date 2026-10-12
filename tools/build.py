"""台本（scripts/YYYY-MM-DD.txt）を検査して、ページが読む JSON と一覧（scripts/index.json）を作る。

使い方: python3 tools/build.py scripts/2026-10-12.txt
エラーがあれば終了コード1で止まり、JSONは書き出さない。
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "scripts"

# ページの選択肢と揃える（index.html の VOICES）
VOICES = {
    "en-US-GuyNeural", "en-US-AndrewNeural", "en-US-BrianNeural",
    "en-US-JennyNeural", "en-US-AriaNeural", "en-US-EmmaNeural", "en-US-AvaNeural",
    "en-US-AnaNeural",
}
WORDS_MIN, WORDS_MAX = 1300, 1450  # 12〜13分
WPM = 109  # 実測: 1,758語で16分07秒（2026-10-12。会話の切れ目の間を含む）

RE_RUBY = re.compile(r"\{([^{}|]+)\|([^{}|]+)\}")
RE_FLAP = re.compile(r"⟨([a-z]{1,2})⟩")
RE_DROP = re.compile(r"\(([a-z])\)")


def plain(md: str) -> str:
    s = RE_RUBY.sub(r"\1", md)
    s = RE_FLAP.sub(r"\1", s)
    s = RE_DROP.sub(r"\1", s)
    return s.replace("‿", " ")


def check_markup(md: str) -> list[str]:
    errs = []
    rest = RE_DROP.sub("", RE_FLAP.sub("", RE_RUBY.sub("", md)))
    for ch in "{}|⟨⟩()":
        if ch in rest:
            errs.append(f"印の書き方が崩れている（{ch}）")
    if re.search(r"(^|\s)‿|‿(\s|$)", md):
        errs.append("‿ の前後に空白がある（‿ は単語のあいだの空白の代わりに置く）")
    for m in RE_RUBY.finditer(md):
        if any(c in m.group(0) for c in "‿⟨⟩()"):
            errs.append(f"{{…|…}} の中に別の印がある: {m.group(0)}")
    return errs


def parse(path: Path):
    meta, cast, lines, errs = {}, {}, [], []
    for n, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("//"):
            continue
        where = f"{path.name}:{n}"
        if line.startswith("## "):
            en, _, ja = line[3:].partition("||")
            if not ja.strip():
                errs.append(f"{where}: 場面の和訳がない")
            if any(c in en for c in "‿⟨⟩{}|()"):
                errs.append(f"{where}: 場面の見出しに印がある（見出しは読み上げないので印を付けない）")
            lines.append({"scene": en.strip(), "ja": ja.strip()})
            continue
        m = re.match(r"^([A-Z]):\s*(.+)$", line)
        if m and cast:
            who, body = m.groups()
            en, _, ja = body.partition("||")
            en, ja = en.strip(), ja.strip()
            if who not in cast:
                errs.append(f"{where}: 登場人物 {who} が cast にない")
            if not ja:
                errs.append(f"{where}: 和訳がない")
            errs += [f"{where}: {e}" for e in check_markup(en)]
            lines.append({"s": who, "en": en, "ja": ja})
            continue
        key, sep, val = line.partition(":")
        if not sep:
            errs.append(f"{where}: 読めない行")
            continue
        key, val = key.strip(), val.strip()
        if key == "cast":
            parts = [p.strip() for p in val.split("|")]
            if len(parts) != 4:
                errs.append(f"{where}: cast は「記号 | 名前 | 役（日本語） | 声」の4つ")
                continue
            sym, name, role, voice = parts
            if voice not in VOICES:
                errs.append(f"{where}: 声 {voice} は使えない（{', '.join(sorted(VOICES))}）")
            cast[sym] = {"name": name, "role_ja": role, "voice": voice}
        else:
            meta[key] = val
    for k in ("title", "title_ja", "relation"):
        if not meta.get(k):
            errs.append(f"{path.name}: {k}: がない")
    return meta, cast, lines, errs


def main(argv):
    if len(argv) != 2:
        print(__doc__)
        return 1
    path = Path(argv[1]).resolve()
    sid = path.stem
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", sid):
        print("ファイル名は YYYY-MM-DD.txt にする")
        return 1
    meta, cast, lines, errs = parse(path)
    spoken = [l for l in lines if "s" in l]
    words = sum(len(plain(l["en"]).split()) for l in spoken)
    marks = {
        "linking": sum(l["en"].count("‿") for l in spoken),
        "flap": sum(len(RE_FLAP.findall(l["en"])) for l in spoken),
        "reduction": sum(len(RE_RUBY.findall(l["en"])) + len(RE_DROP.findall(l["en"])) for l in spoken),
    }
    if errs:
        print("\n".join(errs))
        print(f"エラー {len(errs)} 件。JSONは書き出していません。")
        return 1
    data = {"id": sid, **meta, "cast": cast, "words": words, "lines": lines}
    (SCRIPTS / f"{sid}.json").write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    idx_path = SCRIPTS / "index.json"
    index = json.loads(idx_path.read_text(encoding="utf-8")) if idx_path.exists() else []
    index = [e for e in index if e["id"] != sid]
    index.append({"id": sid, "title": meta["title"], "title_ja": meta["title_ja"],
                  "relation": meta["relation"], "words": words})
    index.sort(key=lambda e: e["id"], reverse=True)
    idx_path.write_text(json.dumps(index, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    print(f"{sid}: {len(spoken)}文 / {words}語（約{words / WPM:.0f}分） / 場面{len(lines) - len(spoken)}")
    print(f"印: リンキング{marks['linking']} フラッピング{marks['flap']} リダクション{marks['reduction']}")
    if not WORDS_MIN <= words <= WORDS_MAX:
        print(f"注意: 語数が目安（{WORDS_MIN}〜{WORDS_MAX}語）から外れている")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
