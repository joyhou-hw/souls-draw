import base64
import json
import os
import subprocess
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import matte as matte_mod

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMAGES = os.path.join(ROOT, "spirit", "assets", "images")

MODEL = "doubao-seedream-5.0-flash"

STYLE = (
    "东方水墨动画风格，参考《罗小黑战记》画风。"
    "手绘感圆润线条，低饱和暖灰色调，水彩晕染质感，柔光无强对比，留白克制，温和日常轻奇幻氛围。"
)


def arkcli_entry():
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


def find_b64(node):
    if isinstance(node, dict):
        if isinstance(node.get("b64_json"), str):
            return node["b64_json"]
        for v in node.values():
            hit = find_b64(v)
            if hit:
                return hit
    elif isinstance(node, list):
        for v in node:
            hit = find_b64(v)
            if hit:
                return hit
    return None


def run_generate(params):
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
    r = subprocess.run(
        argv,
        env=clean_env(),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    out = (r.stdout or "").strip()
    if r.returncode != 0:
        return None, f"exit={r.returncode} stderr={(r.stderr or '')[:300]} stdout={out[:300]}"
    try:
        data = json.loads(out)
    except Exception as e:
        return None, f"json parse error: {e} out={out[:300]}"
    if isinstance(data, dict):
        if data.get("ok") is False:
            return None, json.dumps(data.get("error"), ensure_ascii=False)[:500]
        if "error" in data:
            return None, json.dumps(data["error"], ensure_ascii=False)[:500]
    b64 = find_b64(data)
    if not b64:
        return None, f"no b64_json found; out={out[:300]}"
    return base64.b64decode(b64), None


PLACES = {
    "forest": ("深林", "古木参天，藤蔓垂落，林间有微光浮游"),
    "city": ("城市", "窄巷石板路，屋檐层叠，远处有炊烟"),
    "guild_land": ("会馆领地", "围墙院落，门楣悬灯，院中有老树"),
    "hermit_island": ("隐修岛", "水雾环绕的孤岛，石阶没入云中"),
}

ERAS = {
    "ancient": ("古代", "古代风貌，木质建筑，纸灯笼"),
    "modern": ("现代", "现代都市，混凝土与玻璃，路灯"),
}

SCENES = [
    (f"{place}_{era}", place, era)
    for place in PLACES
    for era in ERAS
]


def scene_prompt(place, era):
    place_name, place_desc = PLACES[place]
    era_name, era_desc = ERAS[era]
    return (
        f"{STYLE}横向构图。场景：{place_name}，{era_name}。"
        f"{place_desc}；{era_desc}。"
        f"画面中无人物，纯场景底图，留出中央人物位。横向 16:9 构图。"
    )


ACTORS = [
    {
        "id": "animal_yao_cat_black_cat_youth_plain_robe_standing",
        "race": "animal_yao",
        "form": "cat",
        "variety": "black_cat",
        "age_band": "youth",
        "outfit": "plain_robe",
        "pose": "standing",
        "race_label": "动物妖",
        "form_label": "猫妖",
        "variety_label": "黑猫",
        "race_appearance": "人形但保留动物特征（耳、尾、瞳）",
        "form_appearance": "猫耳猫尾，纯黑毛色，金色瞳",
        "age_note": "身形修长，朝气",
        "outfit_note": "素色短褐，平民日常",
        "pose_note": "自然站立，微侧",
    },
    {
        "id": "animal_yao_cat_orange_cat_child_guild_uniform_sitting",
        "race": "animal_yao",
        "form": "cat",
        "variety": "orange_cat",
        "age_band": "child",
        "outfit": "guild_uniform",
        "pose": "sitting",
        "race_label": "动物妖",
        "form_label": "猫妖",
        "variety_label": "橘猫",
        "race_appearance": "人形但保留动物特征（耳、尾、瞳）",
        "form_appearance": "猫耳猫尾，橘色虎斑纹",
        "age_note": "身形矮小，面容稚嫩",
        "outfit_note": "深色制服，袖口有会馆徽纹",
        "pose_note": "盘坐或垂足坐",
    },
    {
        "id": "human_adult_hermit_garb_meditating",
        "race": "human",
        "form": None,
        "variety": None,
        "age_band": "adult",
        "outfit": "hermit_garb",
        "pose": "meditating",
        "race_label": "人类",
        "form_label": "",
        "variety_label": "",
        "race_appearance": "普通人形，无妖精特征",
        "form_appearance": "",
        "age_note": "身形沉稳，眉目舒展",
        "outfit_note": "宽袍大袖，云纹暗绣",
        "pose_note": "闭目打坐，灵气微光",
    },
    {
        "id": "plant_yao_flower_peony_adult_ritual_dress_standing",
        "race": "plant_yao",
        "form": "flower",
        "variety": "peony",
        "age_band": "adult",
        "outfit": "ritual_dress",
        "pose": "standing",
        "race_label": "植物妖",
        "form_label": "花妖",
        "variety_label": "牡丹",
        "race_appearance": "人形但带植物特征（花瓣发饰、叶片纹路）",
        "form_appearance": "牡丹花瓣为裙摆，叶脉纹路",
        "age_note": "身形沉稳，眉目舒展",
        "outfit_note": "仪式用盛装，有灵纹",
        "pose_note": "自然站立，微侧",
    },
]

AGE_LABELS = {
    "child": "幼年",
    "youth": "少年",
    "adult": "成年",
    "elder": "老年",
}

OUTFIT_LABELS = {
    "plain_robe": "布衣",
    "guild_uniform": "会馆制服",
    "hermit_garb": "隐修服",
    "mortal_clothes": "凡人常服",
    "ritual_dress": "法仪服",
}

POSE_LABELS = {
    "standing": "站立",
    "walking": "行走",
    "sitting": "坐",
    "meditating": "冥想",
    "fighting": "战斗",
    "resting": "歇息",
}


def actor_prompt(a):
    if a["form"]:
        form_part = f"{a['form_label']}（{a['variety_label']}）"
    else:
        form_part = ""
    parts = [
        f"角色：{a['race_label']}{form_part}，{AGE_LABELS[a['age_band']]}，"
        f"身着{OUTFIT_LABELS[a['outfit']]}，{POSE_LABELS[a['pose']]}。",
        a["race_appearance"],
        a["form_appearance"],
        a["age_note"],
        a["outfit_note"],
        a["pose_note"],
    ]
    body = "".join([p for p in parts if p])
    return f"{STYLE}居中构图。{body}纯白背景，角色居中，全身，适合图层叠合。"


EFFECTS = [
    ("scene_first_transform", "化形光晕", "人形轮廓被柔光包裹，原形残影渐散"),
    ("guild_recruit", "会馆门徽", "微光徽记浮于身侧"),
    ("init_tier", "灵域展开", "空间涟漪，地面浮现纹路"),
    ("gate_ningxing", "灵质显性", "体表微光流转"),
    ("gate_dayao", "妖气升腾", "身后妖气化形"),
    ("ascend_trigger", "天光破云", "头顶金光穿透"),
    ("scene_hermit_chance", "灵气氤氲", "周围雾气含光"),
    ("shock_war", "战意火花", "掌心或武器火花"),
]


def effect_prompt(label, desc):
    return (
        f"{STYLE}居中构图。特效：{label}。{desc}。"
        f"纯白背景，特效居中，无人物主体，适合叠于图层最上方。"
    )


def actor_rel_path(a):
    if a["form"]:
        return os.path.join(
            "actors", a["race"], a["form"], a["variety"], a["age_band"], a["outfit"], a["pose"] + ".png"
        )
    return os.path.join("actors", a["race"], a["age_band"], a["outfit"], a["pose"] + ".png")


def matte_png(raw_path, out_path, feather):
    im = Image.open(raw_path).convert("RGB")
    arr = np.asarray(im)
    bg = matte_mod.border_median_color(arr)
    rgba = matte_mod.matte_white_to_alpha(arr, bg, tol=24.0, feather=feather)
    Image.fromarray(rgba, mode="RGBA").save(out_path)


def write_prompt_record(path, prompt, params):
    txt = prompt + "\n\n--- params ---\n" + json.dumps(params, ensure_ascii=False, indent=2) + "\n"
    with open(path, "w", encoding="utf-8") as f:
        f.write(txt)


def build_items():
    items = []
    for idx, (sid, place, era) in enumerate(SCENES):
        prompt = scene_prompt(place, era)
        items.append(
            {
                "kind": "scene",
                "id": sid,
                "prompt": prompt,
                "size": "1536x864",
                "rel": os.path.join("scenes", f"{sid}.png"),
                "feather": 1.5,
            }
        )
    for a in ACTORS:
        items.append(
            {
                "kind": "actor",
                "id": a["id"],
                "actor": a,
                "prompt": actor_prompt(a),
                "size": "1024x1024",
                "rel": actor_rel_path(a),
                "feather": 1.5,
            }
        )
    for mid, label, desc in EFFECTS:
        items.append(
            {
                "kind": "effect",
                "id": mid,
                "prompt": effect_prompt(label, desc),
                "size": "1024x1024",
                "rel": os.path.join("effects", f"{mid}.png"),
                "feather": 2.0,
            }
        )
    return items


def main():
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--only", default="")
    args = ap.parse_args()

    items = build_items()
    if args.only:
        wanted = set(args.only.split(","))
        items = [it for it in items if it["id"] in wanted]
    if args.limit:
        items = items[: args.limit]

    manifest = {"version": 1, "style_lock": "luoxiaohei_style", "scenes": [], "actors": [], "companions": [], "effects": []}

    ok = 0
    fail = 0
    for i, it in enumerate(items, 1):
        final = os.path.join(IMAGES, it["rel"])
        if os.path.exists(final):
            print(f"[{i}/{len(items)}] SKIP (exists) {it['rel']}", flush=True)
            ok += 1
            continue

        os.makedirs(os.path.dirname(final), exist_ok=True)

        params = {
            "model": MODEL,
            "prompt": it["prompt"],
            "size": it["size"],
            "output_format": "png",
            "response_format": "b64_json",
            "watermark": False,
            "optimize_prompt": False,
            "seed": 1000 + i,
        }

        print(f"[{i}/{len(items)}] GEN {it['id']} size={it['size']}", flush=True)
        png, err = run_generate(params)
        if err:
            print(f"  FAIL {it['rel']}: {err}", flush=True)
            fail += 1
            continue

        raw = final + ".raw.png"
        with open(raw, "wb") as f:
            f.write(png)

        if it["kind"] == "scene":
            os.replace(raw, final)
        else:
            try:
                matte_png(raw, final, it["feather"])
                os.remove(raw)
            except Exception as e:
                print(f"  MATTE FAIL {it['rel']}: {e}", flush=True)
                os.replace(raw, final)
                fail += 1
                continue

        write_prompt_record(final + ".prompt.txt", it["prompt"], params)
        print(f"  OK {it['rel']} ({len(png)} bytes)", flush=True)
        ok += 1

    if os.path.exists(os.path.join(IMAGES, "scenes")):
        for sid, place, era in SCENES:
            manifest["scenes"].append(
                {"id": sid, "place": place, "era": era, "file": f"scenes/{sid}.png"}
            )
    for a in ACTORS:
        entry = {
            "id": a["id"],
            "race": a["race"],
            "age_band": a["age_band"],
            "outfit": a["outfit"],
            "pose": a["pose"],
            "file": actor_rel_path(a).replace(os.sep, "/"),
        }
        if a["form"]:
            entry["form"] = a["form"]
        if a["variety"]:
            entry["variety"] = a["variety"]
        manifest["actors"].append(entry)
    for mid, _label, _desc in EFFECTS:
        manifest["effects"].append(
            {"id": mid, "milestone": mid, "file": f"effects/{mid}.png"}
        )

    with open(os.path.join(IMAGES, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    print(f"\nDONE ok={ok} fail={fail} total={len(items)}", flush=True)
    sys.exit(1 if fail else 0)


if __name__ == "__main__":
    main()
