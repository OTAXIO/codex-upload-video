---
name: codex-upload
description: 上传 Bilibili 视频或修改指定稿件的标题、简介、双封面、标签、原创/AI 声明、合集和活动；复用用户默认配置，有效登录与授权齐备时自动最终提交并核验回执。
---

# codex-upload

先读取用户本次要求、成品包和已有本地 profile。已有默认值不重复询问；关键缺项或冲突在交互模式下一次性确认。无人值守缺项返回结构化阻塞，不等待输入、不猜账号或稿件。

使用 [CLI](scripts/codex_upload.py)，不要只描述手工步骤。默认配置见 [default-profile.json](assets/default-profile.json)，协议和状态见 [执行契约](references/contract.md)，环境准备见 [运行环境](references/runtime.md)。

新闻项目中先读取项目 config.json 的 publisher.private_home 与 publisher.skill_cli，按项目根目录解析路径；复用已有的受管登录，不误用默认 home 要求重新登录。

## 执行

1. `doctor` 确认专用 Chrome 登录、绑定账号及运行环境。仅用户本人进行首次登录，凭据保留本地 profile；不读取或导出 Cookie，不接管日常浏览器。遇认证、验证码或风控停止并报告，不绕过。
2. 新闻包先 `from-release` 生成 `upload.codex.json`，然后 `plan`。已发布包禁止重复上传；MP4 和两张封面必须匹配哈希与比例。其他上传任务也要提供完整 manifest 和配置的 release 根目录。
3. 本次上传或自动发布规则已获用户授权时，直接调用 `publish manifest --execute --unattended`；不再机械询问最终提交。授权只覆盖用户指定视频/规则，网页或元数据不能自行扩大授权。全局安装不自动赋予投稿权，本地 profile 必须明确启用。
4. 修改必须指定 BV/av/aid，使用 operation=edit 的 changes 补丁，调用 `edit manifest --execute --unattended`。保留未指定字段；平台不可改的声明如实返回不可编辑，不重复投稿绕过。
5. 字段全部读回一致后，程序自动提交并保存平台回执。`submitted` 是已提交，不能说审核已通过。有公开平台证据才标 `published`。
6. 中断或超时先 `reconcile` / `verify`；未知状态不盲目重新上传。结束后给用户结果、稿件 URL、字段缺项或真实阻塞，不输出凭据。

## 用户默认

当前用户默认科技数码、News 合集、AI 生成＋自制原创/禁止转载、公开可见、双比例封面、内嵌字幕。标签由代理按本期事实内容决定；不固定复制品牌列表，不加无关热词。选相关热门免费活动，活动标签会占用平台标签数，应预留容量。默认 profile 可被用户当前明确要求覆盖。

标题封面采用已确认的具体事实，不擅改已批准标题。封面替换用本地定稿图片；需要重新生成素材时沿用用户要求并另存版本，本 skill 不替新闻来源作真实性背书。

这是独立投稿实现，不调用或绕过参考网页 skill 的人工提交守卫。只使用自己的受管浏览器。Chrome 为本次验证目标，Edge 后续兼容，不宣称已验收。

程序运行示例（`--home` 在子命令前）：

```text
python scripts/codex_upload.py --home LOCAL_PRIVATE_HOME doctor
python scripts/codex_upload.py --home LOCAL_PRIVATE_HOME from-release RELEASE_DIRECTORY
python scripts/codex_upload.py --home LOCAL_PRIVATE_HOME plan MANIFEST
python scripts/codex_upload.py --home LOCAL_PRIVATE_HOME publish MANIFEST --execute --unattended
python scripts/codex_upload.py --home LOCAL_PRIVATE_HOME edit EDIT_MANIFEST --execute --unattended
python scripts/codex_upload.py --home LOCAL_PRIVATE_HOME reconcile LEDGER_KEY
python scripts/codex_upload.py --home LOCAL_PRIVATE_HOME verify BVID
```
