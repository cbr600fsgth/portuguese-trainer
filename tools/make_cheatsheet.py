#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["openpyxl"]
# ///
"""data/phrases.json から A4 横 1 枚のカンペ (xlsx) を生成する。

シチュエーションでグルーピングし、各グループ内は現場での会話の流れに沿って並べる。
3 段組で左段の上から右段の下へ読み進める構成。
"""
import json
import sys
import unicodedata
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.properties import PageSetupProperties

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "phrases.json"
OUT = ROOT / "cheatsheet.xlsx"

FONT = "Arial"
BODY_PT = 6.5
ROW_PT = 10.3

# ---------------------------------------------------------------- 構成定義
# (見出し, 色キー, フレーズ id の並び) を会話のシーケンス順に並べる。
GROUPS = [
    ("あいさつ・基本マナー", "greet", [
        "greet-01", "greet-02", "greet-03", "greet-04",
        "greet-09", "greet-08", "greet-10", "greet-11",
        "greet-05", "greet-06", "greet-07", "greet-12",
    ]),
    ("受け答え・聞き返し", "greet", [
        "basic-01", "basic-02", "basic-03", "basic-04",
        "basic-05", "basic-08", "basic-06", "basic-07",
    ]),
    ("万能フレーズ（差し替えて使う型）", "greet", [
        "pedir-01", "pedir-02", "pedir-05", "pedir-04",
        "pedir-03", "pedir-08", "pedir-06", "pedir-07",
    ]),
    ("数字・金額", "num", [
        "numero-01", "numero-02", "numero-03", "numero-04", "numero-05",
        "numero-06", "numero-07", "num2-01", "num2-02", "num2-03",
        "num2-04", "num2-05", "num2-06",
    ]),
    ("時刻・日付", "num", [
        "num2-07", "num2-08", "num2-09", "num2-10",
        "num2-11", "num2-12", "num2-13",
    ]),
    ("レストラン(1) 入店・着席", "food", [
        "rest-01", "rest-02", "rest-03", "rest-04", "rest-05",
    ]),
    ("レストラン(2) 注文", "food", [
        "rest-06", "rest-07", "rest-08",
        "couvert-03", "couvert-04", "rest-15",
        "rest-09", "rest-10", "couvert-05",
        "rest-13", "rest-11", "rest-12",
    ]),
    ("レストラン(3) 食事中", "food", [
        "couvert-01", "couvert-02", "rest-14",
    ]),
    ("レストラン(4) 会計", "food", [
        "conta-01", "conta-02", "conta-03", "conta-04", "conta-06", "conta-05",
    ]),
    ("カフェ・軽食", "food", [
        "cafe-01", "cafe-02", "cafe-03", "cafe-09",
        "cafe-04", "cafe-05", "cafe-08", "cafe-06", "cafe-07",
    ]),
    ("交通(1) 切符・乗り場", "trans", [
        "trans-01", "trans-07", "trans-02", "trans-03",
        "trans-04", "trans-05", "trans-21", "trans-13",
    ]),
    ("交通(2) 乗車中", "trans", [
        "trans-06", "trans-12", "trans-08",
        "trans-09", "trans-10", "trans-11",
    ]),
    ("交通(3) タクシー・道", "trans", [
        "trans-14", "trans-15", "trans-16", "trans-18",
        "trans-17", "trans-19", "trans-20", "trans-22",
    ]),
    ("ホテル(1) チェックイン", "hotel", [
        "hotel-01", "hotel-02", "hotel-03",
        "hotel-04", "hotel-05", "hotel-06",
    ]),
    ("ホテル(2) 滞在中・不具合", "hotel", [
        "hotel-07", "hotel-08", "hotel-09", "hotel-10", "hotel-11",
    ]),
    ("ホテル(3) チェックアウト", "hotel", [
        "hotel-13", "hotel-12", "hotel-14", "hotel-15", "hotel-16",
    ]),
    ("買い物", "shop", [
        "shop-01", "shop-17", "shop-02", "shop-18", "shop-03",
        "shop-04", "shop-05", "shop-11", "shop-06", "shop-09",
        "shop-07", "shop-08", "shop-10", "shop-19",
    ]),
    ("観光・見学", "shop", [
        "shop-14", "shop-12", "shop-13", "shop-15", "shop-16",
    ]),
    ("体調・薬", "prob", [
        "prob-02", "prob-03", "prob-04", "prob-05", "prob-06",
    ]),
    ("緊急・トラブル", "prob", [
        "prob-01", "prob-10", "prob-07", "prob-08", "prob-09",
    ]),
]

# 3段目の余白に入れる発音の要点。(ルール, 例, 読み)
TIPS = ("発音の要点", "tips", [
    ("語末の s・z は「シュ」", "dois / dez", "ドイシュ、デシュ"),
    ("語頭 r・語中 rr は喉の「ハ行」", "reserva / garrafa", "フゼルヴァ、ガハーファ"),
    ("ão は鼻音で「アォン」", "não / cartão", "ナォン、カルタォン"),
    ("ch「シュ」lh「リャ」nh「ニュ」", "chega / grelhado", "シェーガ、グレリャードゥ"),
    ("無強勢の e はほぼ消える", "está / de", "シュタ、ドゥ"),
    ("語末の o は「ウ」寄り", "obrigado", "オブリガードゥ"),
])

# 段の切れ目（GROUPS のインデックス）。行数が3段でほぼ均等になる位置。
COLUMN_BREAKS = [0, 6, 13, len(GROUPS)]

FILLS = {
    "greet": "DCE6F1",
    "num":   "FDF0CE",
    "food":  "FBE0D5",
    "trans": "DFEEDA",
    "hotel": "DEE2E8",
    "shop":  "E6E0EF",
    "prob":  "F8D5D5",
    "tips":  "EFEFEF",
}
HEAD_FONT_COLOR = "1F3050"

# 段ごとの列: 日本語 / ポルトガル語 / カナ + 段間スペーサ
BLOCK_WIDTHS = (14.6, 18.1, 21.1)
SPACER_WIDTH = 0.9


def display_width(text: str) -> float:
    """全角を 1.0、半角を 0.5 として数えたおおよその表示幅。"""
    return sum(1.0 if unicodedata.east_asian_width(c) in "WFA" else 0.5 for c in text)


def main() -> int:
    data = json.loads(SRC.read_text(encoding="utf-8"))
    by_id = {p["id"]: p for p in data["phrases"]}

    ordered_ids = [pid for _, _, ids in GROUPS for pid in ids]
    missing = [pid for pid in ordered_ids if pid not in by_id]
    extra = [p["id"] for p in data["phrases"] if p["id"] not in set(ordered_ids)]
    dupes = [pid for pid in set(ordered_ids) if ordered_ids.count(pid) > 1]
    if missing or extra or dupes:
        print(f"構成定義の不整合: missing={missing} extra={extra} dupes={dupes}", file=sys.stderr)
        return 1

    # ---------------------------------------------------------- 段への割り付け
    blocks = []
    for i in range(len(COLUMN_BREAKS) - 1):
        rows = []
        for title, key, ids in GROUPS[COLUMN_BREAKS[i]:COLUMN_BREAKS[i + 1]]:
            rows.append(("head", title, key))
            for pid in ids:
                rows.append(("item", by_id[pid], key))
        if i == len(COLUMN_BREAKS) - 2:
            rows.append(("head", TIPS[0], TIPS[1]))
            for triple in TIPS[2]:
                rows.append(("tip", triple, TIPS[1]))
        blocks.append(rows)

    body_rows = max(len(b) for b in blocks)

    wb = Workbook()
    ws = wb.active
    ws.title = "カンペ"

    thin = Side(style="hair", color="BFBFBF")
    body_font = Font(name=FONT, size=BODY_PT)
    body_font_b = Font(name=FONT, size=BODY_PT, bold=True)
    head_font = Font(name=FONT, size=BODY_PT + 0.5, bold=True, color=HEAD_FONT_COLOR)
    align_l = Alignment(horizontal="left", vertical="center", shrink_to_fit=True)
    align_head = Alignment(horizontal="left", vertical="center", indent=0)
    border_b = Border(bottom=thin)

    TITLE_ROW, LABEL_ROW, FIRST_ROW = 1, 2, 3

    # 列幅
    col = 1
    block_first_col = []
    for b in range(3):
        block_first_col.append(col)
        for w in BLOCK_WIDTHS:
            ws.column_dimensions[get_column_letter(col)].width = w
            col += 1
        if b < 2:
            ws.column_dimensions[get_column_letter(col)].width = SPACER_WIDTH
            col += 1
    last_col = col - 1

    # タイトル行
    ws.cell(TITLE_ROW, 1, "ポルトガル語カンペ（ヨーロッパポルトガル語 pt-PT）　太字＝最優先フレーズ")
    ws.cell(TITLE_ROW, 1).font = Font(name=FONT, size=9, bold=True, color=HEAD_FONT_COLOR)
    ws.merge_cells(start_row=TITLE_ROW, start_column=1, end_row=TITLE_ROW, end_column=last_col)
    ws.row_dimensions[TITLE_ROW].height = 13

    # 列ラベル行
    for c0 in block_first_col:
        for off, label in enumerate(("日本語", "ポルトガル語", "読み方（カナ）")):
            cell = ws.cell(LABEL_ROW, c0 + off, label)
            cell.font = Font(name=FONT, size=BODY_PT, bold=True, color="595959")
            cell.alignment = align_l
            cell.border = Border(bottom=Side(style="thin", color="808080"))
    ws.row_dimensions[LABEL_ROW].height = ROW_PT

    # 本体
    for b, rows in enumerate(blocks):
        c0 = block_first_col[b]
        for r, entry in enumerate(rows):
            row = FIRST_ROW + r
            kind = entry[0]
            fill = PatternFill("solid", fgColor=FILLS[entry[2]])
            if kind == "head":
                cell = ws.cell(row, c0, entry[1])
                cell.font = head_font
                cell.alignment = align_head
                ws.merge_cells(start_row=row, start_column=c0, end_row=row, end_column=c0 + 2)
                for off in range(3):
                    ws.cell(row, c0 + off).fill = fill
                    ws.cell(row, c0 + off).border = Border(
                        bottom=Side(style="thin", color="808080"))
            else:
                if kind == "tip":
                    values = entry[1]
                    must = False
                else:
                    p = entry[1]
                    must = "must" in p.get("tags", [])
                    values = (p["jp"], p["pt"], p["kana"])
                for off, value in enumerate(values):
                    cell = ws.cell(row, c0 + off, value)
                    cell.font = body_font_b if (must and off == 1) else body_font
                    cell.alignment = align_l
                    cell.border = border_b
                    if kind == "tip":
                        cell.fill = fill

    for r in range(FIRST_ROW, FIRST_ROW + body_rows):
        ws.row_dimensions[r].height = ROW_PT

    # 印刷設定
    ws.sheet_properties.pageSetUpPr = PageSetupProperties(fitToPage=True)
    ws.page_setup.orientation = "landscape"
    ws.page_setup.paperSize = ws.PAPERSIZE_A4
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 1
    ws.page_margins.left = ws.page_margins.right = 0.15
    ws.page_margins.top = ws.page_margins.bottom = 0.15
    ws.page_margins.header = ws.page_margins.footer = 0
    ws.print_options.horizontalCentered = True
    last_row = FIRST_ROW + body_rows - 1
    ws.print_area = f"A1:{get_column_letter(last_col)}{last_row}"
    ws.sheet_view.showGridLines = False

    # ------------------------------------------------------------ 全データ表
    ws2 = wb.create_sheet("全データ")
    headers = ["No.", "グループ", "日本語", "ポルトガル語", "読み方（カナ）",
               "イタリア語", "メモ", "最優先", "週", "id"]
    widths = [5, 22, 26, 34, 32, 28, 52, 7, 5, 11]
    for i, (h, w) in enumerate(zip(headers, widths), start=1):
        cell = ws2.cell(1, i, h)
        cell.font = Font(name=FONT, size=10, bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor="44546A")
        cell.alignment = Alignment(vertical="center")
        ws2.column_dimensions[get_column_letter(i)].width = w

    n = 0
    for title, key, ids in GROUPS:
        for pid in ids:
            p = by_id[pid]
            n += 1
            values = [n, title, p["jp"], p["pt"], p["kana"], p["it"], p["note"],
                      "●" if "must" in p.get("tags", []) else "", p["week"], p["id"]]
            for i, v in enumerate(values, start=1):
                cell = ws2.cell(n + 1, i, v)
                cell.font = Font(name=FONT, size=10)
                cell.alignment = Alignment(vertical="center", wrap_text=(i == 7))
            ws2.cell(n + 1, 2).fill = PatternFill("solid", fgColor=FILLS[key])
    ws2.freeze_panes = "C2"
    ws2.auto_filter.ref = f"A1:{get_column_letter(len(headers))}{n + 1}"

    wb.save(OUT)

    # ------------------------------------------------------------ 情報出力
    print(f"saved: {OUT}")
    print(f"phrases={len(ordered_ids)} groups={len(GROUPS)} block_rows={[len(b) for b in blocks]}")
    for b, rows in enumerate(blocks):
        for off, field in enumerate(("jp", "pt", "kana")):
            widths_ = sorted(display_width(e[1][field]) for e in rows if e[0] == "item")
            p75 = widths_[int(len(widths_) * 0.75)]
            print(f"  block{b} {field}: p75={p75:.1f} max={widths_[-1]:.1f} "
                  f"(列幅 {BLOCK_WIDTHS[off]} ≒ {BLOCK_WIDTHS[off] * 7 / (BODY_PT * 96 / 72 / 2):.1f}全角)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
