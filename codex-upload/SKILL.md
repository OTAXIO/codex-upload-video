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

当前用户默认科技数码、News 合集、AI 生成＋自制原创/禁止转载、公开可见、双比例封面、内嵌字幕。标签由代理按本期事实内容决定；不固定复制品牌列表，不加无关热词。固定活动“明日方舟终末地创作者应援计划”（话题ID1325166），替换科技猎手；精确ID和名称，不按热门度自动替代。活动未出现在推荐中时用精确活动标签输入回车并核对平台活动图标；不可用则停止报告。活动标签会占用平台标签数，应预留容量。默认 profile 可被用户当前明确要求覆盖。

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


## 投稿可靠性约束

- 表单按实际状态设置。发生最终读回不一致时，只修对应字段一次，不重填整个表单，不重选视频。新稿/自动填充/重试均使用同一路径。
- 封面由cover_editor.mjs按原生结构处理：等待编辑器、实际中心点击及独占比例激活、唯一组件输入、真实crop-box裁切与本地目标比较、保存重开再比较。白边不能掩盖错误内容。最终提交独立检查当前页面的双封面验证记录；更换目标或导航后不能复用。未知结构、未知弹窗、认证及限流停止，保留阶段诊断，不自动重放失败的封面事务。
- News 按稳定合集 ID 和完整目录次序消歧，同项点击可能取消选择；只在同表单有限恢复并读回，不按同名切换另一合集。
- 最终按钮只点击一次。已有 submit_started=true 时代码拒绝再次提交；只接收实际 POST 的平台 code0 与 aid/BV 作为成功回执。
- unknown 先回查。只有同步字段错误、submit_started=false、创作中心成功回查三项齐备才允许安全恢复；超时/缺标志/已经开始提交不盲目重投。安全回查确认未进入最终提交、且故障已修复后可自动恢复，不设固定次数上限；每次重新回查并累计审计次数，未知提交、已提交、登录/验证码/风控仍按原规则停止，不盲目重复上传。
- 已授权正式新闻技术检查通过后继续投稿，人工试听不是新增授权关卡。用户明确暂停/审核及实际音频错误仍须遵守。
- 更新后在源码仓库执行validate.py（--node/--browser/--puppeteer指定既有运行环境）：必须实际隔离Chrome且零跳过，通过原生双封面正反向用例及整表单联测。不得以真实投稿代替开发验证。记录绑定全部运行模块、技能、测试与夹具哈希，任一变化使旧验证失效。
- 项目sync_upload_skill.py --apply --installed仅接受当前源码完整通过的验证记录，部署后核对生产和安装副本，异常回滚。--check --installed只读检查。生产桥接器在浏览器启动前检查全部运行模块指纹及验证证据；缺失或漂移不能上传。CLI doctor报告implementation_sha256。
- 封面/定位错误同时记录代码和公开上传输入签名；相同故障且二者都未改变时返回REPAIR_REQUIRED，不原样重投。修复验证后可继续，不设恢复次数上限；每次仍必须先回查。

Chrome 对 BV1WLnf6fEgM 和早报 BV1yqHF6YEug 已有真实提交及公开核验；Edge 和未来新平台改版另行验证。本次修复后的字段级恢复经隔离 Chrome 验证，不冒充又一次真实新稿实投。授权范围仍由当前用户要求和本地配置决定。


2026-10-27 用户明确要求：今后投稿标签禁用Claude（大小写变体及带#形式同样排除）。from-release自动过滤，直接manifest验证拒绝；不影响标题、文稿和新闻中的正常公司/产品名称。本次午报使用AI、人工智能、科技资讯、新闻四个通用标签，固定活动规则保持。


2026-10-27 活动接入更正（用户指示在参与活动下搜索）：固定活动不允许作为普通标签直接创建。实际打开“参与话题→搜索更多话题”，搜索全名得到唯一“明日方舟终末地创作者应援计划”结果，带活动图标，约12亿播放；官网活动组件确认topic_id=1325166。投稿器现在通过此搜索弹窗精确全名选中并点弹窗“确定”，再核对表单活动图标；没有精确活动则停止。官方入口同时带topic_id/topic_name/from=activity。禁止以普通tag伪装活动，也不换热门活动。Claude标签排除继续生效。

封面同步提示按用户指定选择“不同步，手动编辑”，分别保存4:3和16:9定稿，不确认同步覆盖另一比例；仍须与本地目标图像及保存读回比较。仅处理结构与文字匹配的已知提示。
