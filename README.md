# 幸运数字（Lucky Numbers）

2–4 人的数字排布桌游，网页联机版。规则书在 `~/Desktop/游戏规则/幸运数字.md`。线上 https://gulugagame.com/lucky/ 。

## 本地运行

```bash
npm install
npm run dev          # 服务端 :3009，网页 :5182
npm test             # 规则引擎、人机、教程剧本、服务器
npm run typecheck
```

## 规则要点

- 每人 4×4 棋盘，每一行从左到右、每一列从上到下严格递增（同行同列不能重复）。第一个摆满 16 格的人获胜。
- 牌池 1–20 每个数字的份数 = 玩家人数。开局每人盲抽 4 张，从小到大摆在对角线上（规则书的「简易开局」）。
- 每回合二选一：从牌池盲抽一张（放上棋盘或弃到桌面），或拿桌面上的一张明牌（必须放上棋盘）。放牌可以放进空格，也可以换下已有的牌，换下的牌放到桌面。

规则书没写死、这里这样处理的地方：

| 情况 | 处理 |
| --- | --- |
| 牌池抽光 | 抽到最后一张的那个回合结束后立刻结算：棋盘上牌最多的人获胜，一样多就并列 |
| 桌面上的明牌放不进自己的棋盘 | 不能拿（拿了必须放，所以界面上不让点） |
| 从牌池抽的牌别人看不看得到 | 看不到，放下或弃掉后才公开 |
| 限时 | 每一步 45 秒。还没选：从牌池抽一张直接弃掉；手里是抽来的牌：弃掉；手里是拿来的明牌：放到第一个能放的位置（优先空格） |
| 变体 | Michael 开局、Bruno 变体、多局计分都没做 |
| 人机 | 房主在等待时点空座位上的「加人机」（咕噜一号 / 二号 / 三号，普通难度）；一个人加满人机也能开局，人机总是同意再来一局。策略在 `packages/game/src/bot.ts`：按每个空格还能放的牌数给棋盘估分，明牌逐张算、盲抽按牌池里剩的牌算期望；拿明牌去顶替必须让这一格更接近理想数字（防止人机互相换牌停不下来）。模拟对局里对「总是盲抽、放最顺的空格」胜率约 95% |
| 托管 | 连续超时 2 次转托管，由人机代打；自己动一下或点「取消托管」就交还。离线的人轮到时先等 3 秒，再由人机代打（不算超时）；用原昵称回来就交还 |

## 新手教程

首页和等候房间都有入口（地址带 `?tutorial` 直接打开），站内统一做法见 `~/projects/pipeline/handbook/tutorial-notes.md`。不连服务器：浏览器里直接跑规则引擎，牌桌就是真正的 GameBoard，咕噜嘎的对话框叠在上面。

- 剧本 `packages/game/src/tutorial.ts`（29 步 9 课），单测 `tutorial.test.ts`。规则引擎不用随机数，所以只把牌池末尾摆好：开局你抽 5 放进空格，咕噜一号抽 19 放不进空格弃到桌面，你拿 19 换掉右下角的 17，咕噜一号拿走 17；然后 `FAST_FORWARD`（只在剧本里有）换成摆好的残局：牌池剩 3 张，你一格堵死、拿 7 填到 15 格，咕噜一号两格都堵死停在 14 格，牌池抽光 15:14 你赢。
- 共用教练层 `apps/web/src/tutorial/`（从欲罢不能整个复制，不改逻辑），本游戏的部分是 `TutorialMode.tsx`（手机上要高亮的东西很高或偏下时先滚到顶上）和 `tutorialGame.ts`（「提示」的说法、第一次小贴士：拿了明牌、换牌、格子堵死、暗着的明牌、牌池快空）。
- 锚点 `data-tutorial`：my-board、cell:<0–15>、pot、hand、discard、table、take:<数字>、board:<玩家 id>、final、hint。
- 「提示」（键盘 H）只在练习局、或者房间里只有自己和人机时出现。
- 走查脚本 `~/projects/qa-reports/tools/tut-lucky.mjs`（flow / skip / waiting / room，`SHORT=1` 只走到练习局开头），截图在 `~/projects/qa-reports/lucky-tutorial/`。

## 目录

- `packages/game`：纯函数规则引擎（`engine.ts`、`board.ts` 的 `canPlace` / `legalCells`）和测试。
- `apps/server`：Socket.IO 房间、计时、重连、语音信令（和其他游戏同一套）。
- `apps/web`：React 网页。`GameBoard.tsx` 是牌桌，数字牌 = PixelLab 画的空白牌面 + 像素字体数字。
  - 牌桌在电脑和平板上正好占满一屏、不滚动：`useFitLevel` 先用最大的牌面（自己的棋盘 128px），渲染后哪一列放不下就降一档（96、64……），牌面只用原图 32px 的整数倍。手机竖着排，第一屏是提示条、自己的棋盘、牌池和手牌、桌面明牌。
  - 桌面明牌按数字排好，相同的叠成一张标「×2」（只是显示，拿牌规则不变）。
- `art/`：`art.py` 生成候选（首页主图、牌面、四叶草图标），`selection.json` 记选中的，`export.py` 导出到 `apps/web/public/art/`。

## 画面：白天版和夜间版

只有像素风一种画面（原始版本已删掉），配色分夜间（深色，默认）和白天（白底）两种。顶栏「切换白天版 / 切换夜间版」随时切换，只影响自己看到的画面，记在浏览器的 `gm-pixel-theme` 里；gulugagame.com 上的大厅和各个游戏同源，共用这一个选择。

- 夜间配色就是 `app-pixel.css`（首页和等候房间）和 `lucky.css`（牌桌）本身。白天版不单独写：`apps/web/day-theme.ts`（Vite 插件）在构建时把这些样式里和颜色有关的声明照抄一份，选择器前加 `:root[data-theme="day"]`，按 `apps/web/day-palette.ts` 的调色表换成白天的颜色。改夜间样式时白天版自动跟着变，只有新出现的深色需要在调色表里补一行。
- 机械换色不合适的地方在 `apps/web/src/theme-day.css` 里手写。
- `index.html` 里一小段脚本在样式生效前就给 `<html>` 加上 `data-theme="day"`，打开页面不会先闪一下深色；切换逻辑和按钮在 `src/theme.tsx`。

## 部署

服务器上 `~/lucky`，pm2 进程 `lucky`（端口 3009），网页在 `/var/www/lucky`，Caddy `handle_path /lucky/*`（也在付费网关 `@games` 里）。本机运行 `~/projects/deploy.sh lucky`（服务器拉 GitHub 上的 main）。

pm2 按仓库根目录的 `ecosystem.config.cjs` 直接启动一个 `node --import tsx` 进程跑服务端（不经过 `npm start`）。端口和密钥存在 pm2 里，不进仓库。

## 背景音乐

进了房间（等候房间、对局、观战）和新手教程里循环放 `apps/web/public/bgm/lucky.mp3`，首页和房间列表不放。曲子是他用 Suno 做的，原文件在桌面 `bgm v1/幸运数字.mp3`（2026-10-11 接入）。播放器是 `apps/web/src/bgm.tsx`（大厅和各游戏是同一份文件，改了要同步到所有仓库）：一个页面只有一个播放器，从等候房间进牌桌不会从头放；循环处交叉淡化；切到别的标签页时暂停。顶栏的 ♪ 按钮能开关、调音量，设置全站共用（localStorage `gm-music`、`gm-music-volume`，默认开、音量 60）。浏览器要求先点过页面才能出声，从首页点进房间正好满足。

换曲子：把新文件放进 `apps/web/public/bgm/`，用 `~/miniconda3/envs/quant/bin/python -I ~/projects/qa-reports/tools/bgm-analyze.py <文件>` 量出 gain / start / end，改 `App.tsx` 里的 `BGM`。本地检查：`URL=http://localhost:<网页端口>/ node ~/projects/qa-reports/tools/bgm-check.mjs`（进房间、开局、离开、开关、顶栏是否被挤成两行）。

**动作音效**（2026-10-11）：都在 `apps/web/src/game-sfx.ts`，用共用的 `gm-sound.tsx` 即时合成，按每一步的 `game.events` 出声；自己的动作响亮，别人的减半，观战都算别人的；刚进房间 / 重连不出声。从牌池抽 draw（自己的再 flip 一下看到数字）、拿桌面明牌 draw + 轻的 tile、放进空格子 tile；换掉格子里的牌是招牌声（拿起「嗒」+ 滑动 + 放下「嗒」，换下来的牌落到桌面）；弃牌是一张牌滑出去落下；凑满一整行 / 一整列响四叶草铃（招牌声）；终局填满 16 格 sparkle、牌池抽光 reveal，再响赢 / 输。手里有牌时点放不了的格子、该选牌时点拿不了的明牌响 deny；轮到你、最后 5 秒、超时都有提示音。自测：`node ~/projects/qa-reports/tools/lucky-sfx.mjs`，教程：`URL=http://localhost:5182/ node ~/projects/qa-reports/tools/sfx-tut.mjs`。
