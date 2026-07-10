# Task 02 — SQLite 数据层与项目/对话管理

## 目标
主进程内建 SQLite,记录项目、对话、设置;经 IPC 暴露 CRUD。

## 数据表
```sql
-- 项目:按 psd 文件绝对路径去重
projects(
  id INTEGER PK,
  name TEXT,              -- 默认取 psd 文件名
  psd_path TEXT UNIQUE,   -- 绝对路径,去重键
  created_at, updated_at
)

-- 对话:一个项目多条对话(类 codex)
conversations(
  id INTEGER PK,
  project_id INTEGER FK,
  title TEXT,
  tmp_dir TEXT,           -- 本对话的临时工作目录
  export_dir TEXT,        -- 导出路径(默认同 psd 目录,可改并记住)
  opt_trim INTEGER,       -- 裁剪透明边
  opt_1x INTEGER,         -- 1倍图
  opt_2x INTEGER,         -- 2倍图(默认1)
  created_at, updated_at
)

-- 消息:对话历史(用户输入/agent日志/交互确认)
messages(
  id INTEGER PK,
  conversation_id INTEGER FK,
  role TEXT,              -- user / assistant / tool / system
  content TEXT,           -- JSON 或纯文本
  created_at
)

-- 设置:单例键值
settings(key TEXT PK, value TEXT)
-- 键:ps_path, api_base_url, api_key, api_model, default_export_dir ...
```

## 技术要点
- `better-sqlite3`(同步 API,主进程用简洁);DB 文件放 `app.getPath('userData')`。
- 迁移:启动时 `CREATE TABLE IF NOT EXISTS`,预留版本号 `PRAGMA user_version`。
- IPC:`ipcMain.handle('db:projects:*' / 'db:conversations:*' / 'db:settings:*')`。
- 去重:插入 project 前按 `psd_path` 查询,存在则返回既有记录(对应 SPEC「相同文件曾拖入则打开对应项目记录」)。

## 验收
- 拖入同一 psd 两次 → 只有一条 project 记录,第二次返回既有。
- 设置读写往返正确;API key 存储时注意不在日志中回显。

## 依赖
- better-sqlite3(原生模块,需 electron-rebuild)
