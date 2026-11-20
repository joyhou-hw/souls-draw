import json
import os
import sys
from datetime import datetime, timezone

import yaml

TOOLS = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(TOOLS)
WORLD_YAML = os.path.join(ROOT, "spirit", "worlds", "luoxiaohei", "world.yaml")
PLAN_JSON = os.path.join(TOOLS, "batch_plan.json")

sys.path.insert(0, TOOLS)
from generate_batch import STYLE, actor_rel_path  # noqa: E402

MODEL = "doubao-seedream-5-0-flash"

AGE_BANDS = ["child", "youth", "adult", "elder"]
OUTFITS = ["plain_robe", "guild_uniform", "hermit_garb", "mortal_clothes", "ritual_dress"]
POSES = ["standing", "walking", "sitting", "meditating", "fighting", "resting"]

AGE_LABELS = {
    "child": "幼年",
    "youth": "少年",
    "adult": "成年",
    "elder": "老年",
}
AGE_NOTES = {
    "child": "身形矮小，面容稚嫩",
    "youth": "身形修长，朝气",
    "adult": "身形沉稳，眉目舒展",
    "elder": "身形佝偻，须发花白，气质沉静",
}
OUTFIT_LABELS = {
    "plain_robe": "布衣",
    "guild_uniform": "会馆制服",
    "hermit_garb": "隐修服",
    "mortal_clothes": "凡人常服",
    "ritual_dress": "法仪服",
}
OUTFIT_NOTES = {
    "plain_robe": "素色布衣，平民日常",
    "guild_uniform": "深色制服，袖口有会馆徽纹",
    "hermit_garb": "宽袍大袖，云纹暗绣",
    "mortal_clothes": "常人常服，日常朴素",
    "ritual_dress": "法仪式盛装，灵纹缀饰",
}
POSE_LABELS = {
    "standing": "站立",
    "walking": "行走",
    "sitting": "坐",
    "meditating": "冥想",
    "fighting": "战斗",
    "resting": "歇息",
}
POSE_NOTES = {
    "standing": "自然站立，微侧",
    "walking": "迈步前行，衣袂轻扬",
    "sitting": "盘坐或垂足坐",
    "meditating": "闭目打坐，灵气微光",
    "fighting": "戒备姿态，灵力若现",
    "resting": "倚坐小憩，神态安然",
}

RACE_META = {
    "human": ("人类", "普通人形，无妖精特征"),
    "animal_yao": ("动物妖", "人形但保留动物特征（耳、尾、瞳）"),
    "plant_yao": ("植物妖", "人形但带植物特征（花瓣发饰、叶片纹路）"),
    "fungus_yao": ("菌类妖", "人形但带菌类特征（菌盖、菌丝纹理）"),
    "spirit_yao": ("灵体妖", "人形但带灵体特征（半透明、轻灵微光，轮廓柔和）"),
    "painted_yao": ("画灵妖", "人形但带画纸特征（纸片质感、墨迹描边）"),
}

FORM_META = {
    "cat": ("猫妖", "猫耳猫尾，瞳色随毛色"),
    "wolf": ("狼妖", "狼耳狼尾，锐利眼神，体态矫健"),
    "dog": ("犬妖", "犬耳犬尾，温顺眼神"),
    "bull": ("牛妖", "牛角，体型壮实"),
    "goat": ("羊妖", "羊角，体态轻盈"),
    "flower": ("花妖", "花瓣为裙摆，叶脉纹路"),
    "grass": ("草妖", "草叶纹路，柔韧身姿"),
    "tree": ("树妖", "树皮纹理，枝干质感"),
    "mushroom": ("菌妖", "菌盖发饰，菌丝纹理"),
    "wisp": ("灵火妖", "半透明灵体，微光浮动"),
    "paper_creature": ("纸偶妖", "纸片拼贴质感，墨迹轮廓"),
}

VARIETY_META = {
    "orange_cat": ("橘猫", "橘色虎斑纹"),
    "black_cat": ("黑猫", "纯黑毛色，金色瞳"),
    "tabby_cat": ("狸花猫", "灰褐虎斑纹"),
    "calico": ("三花猫", "橙黑白三色斑块"),
    "snow_wolf": ("雪狼", "纯白毛色，冰蓝瞳"),
    "grey_wolf": ("灰狼", "灰褐毛色"),
    "black_wolf": ("黑狼", "纯黑毛色"),
    "rural_dog": ("土狗", "黄褐短毛，朴素"),
    "shiba": ("柴犬", "赤色短毛，立耳卷尾"),
    "shorthair": ("短毛犬", "黑褐短毛"),
    "water_buffalo": ("水牛", "灰黑皮毛，弯角"),
    "ox": ("黄牛", "黄褐皮毛，短角"),
    "mountain_goat": ("山羊", "灰白短毛，直角"),
    "dairy_goat": ("奶羊", "白毛垂耳"),
    "peony": ("牡丹", "牡丹花瓣为衣，雍容"),
    "peach_blossom": ("桃花", "桃花瓣粉，清丽"),
    "orchid": ("兰花", "兰花叶细长，清雅"),
    "epiphyllum": ("昙花", "白色花瓣，夜间莹光"),
    "moonveil": ("月见草", "淡黄小花，月光感"),
    "mugwort": ("艾草", "艾叶清香，灰绿叶纹"),
    "mimosa": ("含羞草", "羽状复叶，含羞姿态"),
    "reed": ("芦苇", "芦苇穗，纤长"),
    "pine": ("松树", "松针纹理，苍劲"),
    "ginkgo": ("银杏", "银杏叶金黄"),
    "locust": ("槐树", "槐叶细密，花白"),
    "lingzhi": ("灵芝", "灵芝菌盖，祥云纹"),
    "fly_agaric": ("毒蝇伞", "红色菌盖，白点"),
    "lantern_flame": ("灯笼火", "暖橙色火光"),
    "creek_mist": ("溪雾", "青白水雾"),
    "firefly_glow": ("萤火", "黄绿微光点"),
}

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

ANCHOR = ("youth", "plain_robe", "standing")

MID_OUTFITS = ["plain_robe", "guild_uniform", "hermit_garb"]
MIN_AGES = ["child", "youth", "adult"]


def load_world():
    with open(WORLD_YAML, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def build_leaves(world):
    leaves = []
    birth_form = world["birthForm"]
    prototypes = birth_form["speciesPrototype"]
    varieties = birth_form["speciesVariety"]

    leaves.append({"race": "human", "form": None, "variety": None})
    for race, forms in prototypes.items():
        for form in forms:
            vs = varieties.get(form, [])
            if vs:
                for v in vs:
                    leaves.append({"race": race, "form": form, "variety": v})
            else:
                leaves.append({"race": race, "form": form, "variety": None})
    return leaves


def tier_for(leaf):
    if leaf["race"] == "human":
        return "full"
    form = leaf["form"]
    if form in ("cat", "wolf", "wisp", "mushroom"):
        return "full"
    if form == "dog":
        return "mid"
    return "min"


def tier_combos(tier):
    if tier == "full":
        return [
            (a, o, p) for a in AGE_BANDS for o in OUTFITS for p in POSES
        ]
    if tier == "mid":
        return [
            (a, o, p) for a in AGE_BANDS for o in MID_OUTFITS for p in ("standing", "walking")
        ]
    return [
        (a, o, p) for a in MIN_AGES for o in MID_OUTFITS for p in ("standing",)
    ]


def phase_for(tier, combo):
    if combo == ANCHOR:
        return "A"
    if tier == "full":
        return "C"
    return "B"


def actor_prompt(leaf, a, o, p):
    race_label, race_app = RACE_META[leaf["race"]]
    if leaf["form"]:
        form_label, form_app = FORM_META[leaf["form"]]
        if leaf["variety"]:
            var_label, var_app = VARIETY_META[leaf["variety"]]
            form_part = f"{form_label}（{var_label}）"
        else:
            var_label = var_app = ""
            form_part = form_label
    else:
        form_label = form_app = var_label = var_app = ""
        form_part = ""

    parts = [
        f"角色：{race_label}{form_part}，{AGE_LABELS[a]}，"
        f"身着{OUTFIT_LABELS[o]}，{POSE_LABELS[p]}。",
        race_app,
        form_app,
        f"{var_label}：{var_app}" if leaf["variety"] else "",
        AGE_NOTES[a],
        OUTFIT_NOTES[o],
        POSE_NOTES[p],
    ]
    body = "".join([x for x in parts if x])
    return f"{STYLE}居中构图。{body}纯白背景，角色居中，全身，适合图层叠合。"


def scene_prompt(place, era):
    place_name, place_desc = PLACES[place]
    era_name, era_desc = ERAS[era]
    return (
        f"{STYLE}横向构图。场景：{place_name}，{era_name}。"
        f"{place_desc}；{era_desc}。"
        f"画面中无人物，纯场景底图，留出中央人物位。横向 16:9 构图。"
    )


def effect_prompt(label, desc):
    return (
        f"{STYLE}居中构图。特效：{label}。{desc}。"
        f"纯白背景，特效居中，无人物主体，适合叠于图层最上方。"
    )


def build_actor_item(leaf, combo, tier, phase):
    a, o, p = combo
    race = leaf["race"]
    form = leaf["form"]
    variety = leaf["variety"]
    base = {
        "kind": "actor",
        "race": race,
        "form": form,
        "variety": variety,
        "age_band": a,
        "outfit": o,
        "pose": p,
        "tier": tier,
        "phase": phase,
        "size": "1024x1024",
        "feather": 1.5,
        "anchor": combo == ANCHOR,
    }
    segs = [race]
    if form:
        segs.append(form)
    if variety:
        segs.append(variety)
    segs += [a, o, p]
    base["id"] = "_".join(segs)
    base["prompt"] = actor_prompt(leaf, a, o, p)
    base["rel"] = actor_rel_path(base).replace(os.sep, "/")
    return base


def build_items(world):
    items = []

    for place in PLACES:
        for era in ERAS:
            sid = f"{place}_{era}"
            items.append(
                {
                    "kind": "scene",
                    "id": sid,
                    "phase": "A",
                    "tier": "baseline",
                    "prompt": scene_prompt(place, era),
                    "size": "1536x864",
                    "rel": f"scenes/{sid}.png",
                    "feather": 1.5,
                }
            )

    for mid, label, desc in EFFECTS:
        items.append(
            {
                "kind": "effect",
                "id": mid,
                "phase": "A",
                "tier": "baseline",
                "prompt": effect_prompt(label, desc),
                "size": "1024x1024",
                "rel": f"effects/{mid}.png",
                "feather": 2.0,
            }
        )

    leaves = build_leaves(world)
    for leaf in leaves:
        tier = tier_for(leaf)
        for combo in tier_combos(tier):
            phase = phase_for(tier, combo)
            items.append(build_actor_item(leaf, combo, tier, phase))

    return items


def summarize(items):
    totals = {"actors": {}, "scenes": 0, "effects": 0, "grand_total": len(items)}
    phases = {"A": 0, "B": 0, "C": 0}
    tiers = {}
    for it in items:
        phases[it["phase"]] += 1
        if it["kind"] == "actor":
            totals["actors"][it["tier"]] = totals["actors"].get(it["tier"], 0) + 1
            tiers[it["tier"]] = tiers.get(it["tier"], 0) + 1
        elif it["kind"] == "scene":
            totals["scenes"] += 1
        else:
            totals["effects"] += 1
    totals["actors"]["total"] = sum(totals["actors"].values())
    return {"totals": totals, "phases": phases, "tiers": tiers}


def main():
    world = load_world()
    items = build_items(world)
    summary = summarize(items)

    plan = {
        "version": 1,
        "model": MODEL,
        "style_lock": "luoxiaohei_style",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "summary": summary,
        "items": items,
    }

    with open(PLAN_JSON, "w", encoding="utf-8") as f:
        json.dump(plan, f, ensure_ascii=False, indent=2)

    print(json.dumps(summary, ensure_ascii=False, indent=2))
    print(f"\nWROTE {PLAN_JSON}")


if __name__ == "__main__":
    main()
