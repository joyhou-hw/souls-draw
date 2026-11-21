import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from generate_batch import clean_env, run_generate, write_prompt_record, IMAGES

MODEL = "doubao-seedream-5-0-flash"

STYLE = (
    "东方水墨动画风格，参考《罗小黑战记》画风。"
    "手绘感圆润线条，低饱和暖灰色调，水彩晕染质感，柔光无强对比，留白克制，温和日常轻奇幻氛围。"
)

BG_ROOT = os.path.join(IMAGES, "backgrounds")

PAGES = [
    {
        "id": "home",
        "desc": "清晨云雾缭绕的山谷与远山，林间漂浮几点柔光，一片宁静辽阔的东方山水",
    },
    {
        "id": "draw_anim",
        "desc": "神秘灵光汇聚的夜空，柔光涟漪向外扩散，浮游光点环绕，深邃蓝紫渐层",
    },
    {
        "id": "choice",
        "desc": "林中幽静的分岔小径，柔和方向性光柱，象征抉择，留白开阔",
    },
    {
        "id": "end",
        "desc": "极远的地平线与破晓天光，薄雾平原，柔和光晕，静谧悠远",
    },
    {
        "id": "review",
        "desc": "平静湖面倒映柔和天空，零星飘落的花瓣与落叶，怀旧安详",
    },
]

RACES = {
    "human": ("凡人", "中性暖灰基调，隐约极淡的屋舍瓦檐剪影"),
    "animal_yao": ("兽妖", "暖橙灰基调，隐约极淡的皮毛纹理与兽眸微光"),
    "plant_yao": ("草木妖", "青绿基调，隐约极淡的叶片与花瓣轮廓"),
    "fungus_yao": ("菌蕈妖", "黄绿基调，隐约极淡的菌伞圆点与孢子微光"),
    "spirit_yao": ("游灵", "冷蓝紫基调，隐约极淡的漂浮光点与灵雾"),
    "painted_yao": ("器灵", "米白纸张基调，隐约极淡的水墨纸纹与淡彩"),
}

GENDERS = {
    "male": "气质克制冷冽，微冷色倾向",
    "female": "气质柔和温润，微暖色倾向",
}

STAGES = {
    "child": "晨曦般的淡黄嫩绿色调，明亮清透",
    "youth": "青翠山岚与浅天青色调，清新舒展",
    "adult": "沉稳的黛蓝与暖褐色调，厚重沉静",
    "elder": "暮色的暖紫与烟灰色调，柔和安详",
}


def build_items():
    items = []
    for p in PAGES:
        prompt = (
            f"{STYLE}横向构图。{p['desc']}。"
            f"画面中无人物无文字无水印，中央与前景大幅留白，整体低饱和柔和，"
            f"适合作为网页页面背景。"
        )
        items.append(
            {
                "kind": "background",
                "id": f"page_{p['id']}",
                "prompt": prompt,
                "size": "1536x864",
                "rel": os.path.join("backgrounds", "pages", f"{p['id']}.png"),
            }
        )
    for race, (race_label, race_motif) in RACES.items():
        for gender, gender_nuance in GENDERS.items():
            for stage, stage_color in STAGES.items():
                prompt = (
                    f"{STYLE}极简抽象水墨背景。{race_motif}；{gender_nuance}；{stage_color}。"
                    f"大面积柔和单一色块晕染，画面四角轻微水彩纹理，中央与左侧大幅留白空灵，"
                    f"无人物无文字无复杂细节，低饱和低对比，专为网页文字背景设计，不干扰前景文字阅读。"
                )
                items.append(
                    {
                        "kind": "background",
                        "id": f"sim_{race}_{gender}_{stage}",
                        "race": race,
                        "gender": gender,
                        "stage": stage,
                        "prompt": prompt,
                        "size": "1536x864",
                        "rel": os.path.join(
                            "backgrounds", "sim", race, f"{gender}_{stage}.png"
                        ),
                    }
                )
    return items


def main():
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--only", default="")
    ap.add_argument("--max-images", type=int, default=0)
    args = ap.parse_args()

    items = build_items()
    if args.only:
        wanted = set(x for x in args.only.split(",") if x)
        items = [it for it in items if it["id"] in wanted]
    if args.limit:
        items = items[: args.limit]

    done = 0
    gen = 0
    fail = 0
    for i, it in enumerate(items, 1):
        final = os.path.join(IMAGES, it["rel"])
        if os.path.exists(final):
            print(f"[{i}/{len(items)}] SKIP (exists) {it['rel']}", flush=True)
            done += 1
            continue

        if args.max_images > 0 and gen >= args.max_images:
            print(
                f"[{i}/{len(items)}] HOLD (max-images={args.max_images} reached) {it['rel']}",
                flush=True,
            )
            break

        os.makedirs(os.path.dirname(final), exist_ok=True)

        params = {
            "model": MODEL,
            "prompt": it["prompt"],
            "size": it["size"],
            "output_format": "png",
            "response_format": "b64_json",
            "watermark": False,
            "optimize_prompt": False,
            "seed": 2000 + i,
        }

        print(f"[{i}/{len(items)}] GEN {it['id']} size={it['size']}", flush=True)
        png, err = run_generate(params)
        if err:
            print(f"  FAIL {it['rel']}: {err}", flush=True)
            fail += 1
            continue

        with open(final, "wb") as f:
            f.write(png)
        write_prompt_record(final + ".prompt.txt", it["prompt"], params)
        print(f"  OK {it['rel']} ({len(png)} bytes)", flush=True)
        done += 1
        gen += 1

    print(f"\nDONE done={done} gen={gen} fail={fail} total={len(items)}", flush=True)
    sys.exit(1 if fail else 0)


if __name__ == "__main__":
    main()
