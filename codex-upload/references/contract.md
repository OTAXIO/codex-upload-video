# 元数据与状态契约

schema_version=1。路径相对 manifest 所在目录解析，带文件字节数及 SHA-256。上传 manifest 由 `from-release` 生成，包含 operation=upload、episode_id、edition_slot、video、covers、title、description、tags、partition、collection、declarations、activity、visibility、captions_burned。

video 为 {path,bytes,sha256}；covers.four_three / sixteen_nine 另含 width/height。临时新闻另带 alert_id / reset_event_key，counts_toward_daily_main_limit=false。每次发布重新核对 release 状态和资产哈希；所有上传资产必须位于该 release 内。

declarations 明确 original / ai_generated / no_reprint 三个布尔字段。上传页分别核对 AI 声明和自制版权声明。合集优先用稳定 ID，名称重复时仅在唯一已使用合集可明确辨认时自动解析。当前 UI 选项不显示 ID，因此同时核对完整 API 顺序和渲染名称序列，任何不一致均停止，不挑同名第一项。活动仅从推荐话题的可用免费条目中按相关性与页面播放数选择；不是付费推广，也不宣称全站最热。

编辑 manifest 示例：

```json
{
  "schema_version": 1,
  "operation": "edit",
  "target": "BV1aaaaaaaaa",
  "changes": {
    "title": "用户明确要求的新标题",
    "tags": ["AI", "科技资讯"]
  }
}
```

封面编辑提供完整 covers 对象。修改声明时仅当平台仍允许才执行；已提交稿件的声明可能不可改。其余字段不在 changes 中就保留，包括未要求修改的活动、封面和版权项。

上传 key 为 MP4 SHA-256，编辑 key 为完整补丁哈希。另按 episode_id、alert_id、reset_event_key 防止不同编码重复投同一期/重置事件。状态与进度保留在私人 home/state，回执写回成品目录 upload.receipt.json。

状态：starting → uploading → uploaded → submitting → submitted → reviewing/published；失败为 failed，可能已经选文件/提交而缺确定回执时为 unknown。当前 Python ledger 会以 progress 文件保留中间进度，不能把超时当成未提交。已有 submitted/published 回执的相同任务幂等返回。未知上传通过 creator 精确标题、账号和发布时间回查，无法唯一关联则继续 unknown，不自动二投。未知编辑应针对明确稿件检查每个变更字段，不能仅凭标题认为所有修改成功。

最终提交只点一次。必须取得平台 add/edit 的成功回执及 aid/bvid 才记 submitted。公开 view 的归属和状态核对后才记 published。CLI 输出结构化错误，原始浏览器 stderr 不转发到普通日志。
