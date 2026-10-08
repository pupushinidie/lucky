"""幸运数字的美术：首页主图（pixen 512×288）、空白数字牌面和四叶草图标（generate-image-v2，一次 64 个候选）。
结果在 out/，选定的写进 selection.json，再用 export.py 导出到 apps/web/public/art/。
PixelLab 同一时间只跑一个任务，按顺序一个一个来。

用法：python art.py [名字 ...]（不写就全跑；已经出过的跳过）
"""
from __future__ import annotations

import sys

import pixellab

OUT = pixellab.ART / "out"

SPRITES: dict[str, tuple[str, int, int, bool]] = {
    "tile": ("a blank square cream-colored ceramic game tile with a thin green border and a tiny four-leaf clover in one corner, flat front view, filling the whole square", 32, 32, False),
    "clover": ("a lucky green four-leaf clover, game icon", 32, 32, True),
}

SCENES: dict[str, tuple[str, tuple[int, ...]]] = {
    "hero": ("a cozy wooden table in a sunny garden, a 4 by 4 grid board of cream number tiles, scattered four-leaf clovers, a small pouch of tiles, warm afternoon light, top-down three-quarter view, no people", (41, 42, 43)),
}


def sprite(name: str) -> None:
    prompt, width, height, transparent = SPRITES[name]
    folder = OUT / name
    if folder.exists() and any(folder.glob("*.png")):
        print(name, "已有，跳过", flush=True)
        return
    pixellab.generate_async(name, {
        "description": prompt,
        "image_size": {"width": width, "height": height},
        "no_background": transparent,
        "seed": 101,
    }, folder, endpoint="/generate-image-v2")


def scene(name: str) -> None:
    prompt, seeds = SCENES[name]
    for seed in seeds:
        target = f"{name}-s{seed}"
        if (OUT / f"{target}.png").exists():
            continue
        pixellab.generate_image(target, {
            "description": prompt,
            "image_size": {"width": 512, "height": 288},
            "detail": "highly detailed",
            "seed": seed,
        }, OUT, endpoint="/create-image-pixen")


if __name__ == "__main__":
    for name in sys.argv[1:] or [*SPRITES, *SCENES]:
        try:
            sprite(name) if name in SPRITES else scene(name)
        except Exception as error:  # 一项失败不影响后面的
            print(name, "失败：", error, flush=True)
