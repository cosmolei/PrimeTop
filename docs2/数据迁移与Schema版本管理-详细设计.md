# 数据迁移与 Schema 版本管理 - 详细设计

## 1. 概述

### 1.1 设计目标

本文档定义 PrimeTop 项目数据库 Schema 版本管理与数据迁移的完整方案，确保：

1. **可追溯**：每次 Schema 变更都有版本记录、变更描述和回滚脚本。
2. **可重复**：迁移脚本在开发/测试/生产环境执行结果一致。
3. **可回滚**：每次变更提供对应的回滚脚本，支持安全回退。
4. **零停机**：核心业务变更采用兼容性迁移策略，避免锁表和服务中断。
5. **可审计**：迁移执行日志持久化，支持问题排查和合规审计。

### 1.2 适用范围

- 关系型数据库（PostgreSQL 主库）的 DDL 和 DML 迁移
- Elasticsearch 索引 Mapping 变更与 Reindex
- Redis 数据结构变更
- 向量数据库（Milvus）Collection Schema 变更
- ClickHouse 表结构变更

### 1.3 工具选型

| 工具 | 用途 | 版本 |
|------|------|------|
| Alembic | PostgreSQL Schema 迁移 | ≥1.13 |
| Flyway | 备选方案（如团队更熟悉 Java 生态） | ≥10 |
| 自定义脚本 | ES/Redis/Milvus/ClickHouse 迁移 | - |
| Git | 迁移脚本版本控制 | - |

> **决策**：后端基于 Python/FastAPI，Alembic 是 SQLAlchemy 原生搭配，作为首选方案。

---

## 2. 项目结构

### 2.1 迁移目录结构

```
PrimeTop/
├── alembic/                          # Alembic 迁移目录
│   ├── alembic.ini                   # Alembic 配置（生产覆盖）
│   ├── env.py                        # Alembic 环境入口
│   ├── script.py.mako                # 迁移脚本模板
│   └── versions/                     # 迁移版本文件
│       ├── 001_initial_schema.py
│       ├── 002_add_user_wechat_fields.py
│       └── ...
├── migrations/                       # 非 PG 数据库迁移脚本
│   ├── elasticsearch/
│   │   ├── v001_initial_indices.py
│   │   └── v002_add_question_fulltext.py
│   ├── redis/
│   │   └── v001_session_structure.py
│   ├── milvus/
│   │   └── v001_knowledge_vectors.py
│   └── clickhouse/
│       └── v001_event_tables.py
├── scripts/
│   ├── migrate.py                    # 统一迁移入口
│   ├── seed.py                       # 种子数据脚本
│   └── rollback.py                   # 批量回滚脚本
└── tests/
    └── migrations/
        └── test_migration_xxx.py     # 迁移测试
```

### 2.2 Alembic 配置

```ini
# alembic.ini
[alembic]
script_location = alembic
sqlalchemy.url = postgresql://%(DB_USER)s:%(DB_PASS)s@%(DB_HOST)s:%(DB_PORT)s/%(DB_NAME)s

[loggers]
keys = root,sqlalchemy,alembic

[handlers]
keys = console

[formatters]
keys = generic

[logger_root]
level = WARN
handlers = console

[logger_sqlalchemy]
level = WARN
handlers =
qualname = sqlalchemy.engine

[logger_alembic]
level = INFO
handlers =
qualname = alembic

[handler_console]
class = StreamHandler
args = (sys.stderr,)
level = NOTSET
formatter = generic

[formatter_generic]
format = %(levelname)-5.5s [%(name)s] %(message)s
datefmt = %H:%M:%S
```

### 2.3 env.py 核心配置

```python
# alembic/env.py
import os
import sys
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

# 将项目根目录加入 sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.config import settings
from app.core.database import Base

# 导入所有模型，确保 Base.metadata 包含所有表定义
from app.models import (  # noqa: F401
    user, student_profile, parent_binding,
    subject, textbook, chapter, knowledge_point,
    question, answer_record, mistake_record,
    learning_session, study_plan, ai_conversation,
    membership, order, message, notification,
    content, operation_activity, growth_incentive,
)

config = context.config

# 从环境变量覆盖数据库 URL
config.set_main_option("sqlalchemy.url", settings.DATABASE_URL)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """离线模式：生成 SQL 脚本而不执行"""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        # 生成可读的事务包裹 SQL
        transaction_per_migration=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """在线模式：直接连接数据库执行迁移"""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,  # 迁移时使用短连接
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            # 每个迁移使用独立事务
            transaction_per_migration=True,
            # 渲染自定义类型
            render_as_batch=True,  # SQLite 兼容（测试环境）
            compare_type=True,     # 检测类型变更
            compare_server_default=True,  # 检测默认值变更
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
```

---

## 3. 迁移脚本编写规范

### 3.1 迁移脚本模板

```python
# alembic/versions/xxx_description.py
"""Add user wechat fields

Revision ID: 002
Revises: 001
Create Date: 2026-05-20 10:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '002'
down_revision: Union[str, None] = '001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """升级迁移"""
    # 1. DDL 操作
    op.add_column('users', sa.Column('wechat_openid', sa.String(64), nullable=True))
    op.add_column('users', sa.Column('wechat_unionid', sa.String(64), nullable=True))

    # 2. 创建索引（CONCURRENT 避免锁表）
    op.execute(
        "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_users_wechat_openid "
        "ON users (wechat_openid)"
    )

    # 3. 数据迁移（如有）
    # op.execute("UPDATE users SET wechat_openid = NULL")

    # 4. 添加约束（数据就绪后）
    # op.create_unique_constraint('uq_users_wechat_openid', 'users', ['wechat_openid'])


def downgrade() -> None:
    """回滚迁移"""
    op.drop_index('ix_users_wechat_openid', table_name='users')
    op.drop_column('users', 'wechat_unionid')
    op.drop_column('users', 'wechat_openid')
```

### 3.2 命名规范

| 规则 | 示例 |
|------|------|
| 文件名格式 | `{revision_id}_{简短描述}.py` |
| 描述用下划线连接 | `add_user_wechat_fields.py` |
| 描述用动词开头 | `add_`, `remove_`, `rename_`, `alter_`, `create_`, `drop_` |
| revision 递增 | 001, 002, 003...（MVP 阶段手动编号） |
| 禁止修改已合并的迁移 | 一旦合并到 main，不得修改，只能新增 |

### 3.3 迁移分类与策略

#### 3.3.1 兼容性变更（推荐，零停机）

变更前后新旧代码都能正常工作：

```python
def upgrade() -> None:
    """添加新可空列 — 新旧代码兼容"""
    op.add_column('questions', sa.Column('source_type', sa.String(20), nullable=True))

def downgrade() -> None:
    op.drop_column('questions', 'source_type')
```

**操作流程**：
1. 先部署包含新列的数据库迁移
2. 再部署读写新列的应用代码
3. 新列稳定后，后续迁移可改为 NOT NULL

#### 3.3.2 列重命名（双阶段迁移）

**阶段一**：添加新列 + 数据拷贝

```python
"""Phase 1: Add new column and copy data

Revision ID: 010a
"""
revision = '010a'
down_revision = '009'

def upgrade() -> None:
    op.add_column('users', sa.Column('display_name', sa.String(50), nullable=True))
    # 分批拷贝数据，避免长事务
    op.execute("""
        UPDATE users SET display_name = nickname
        WHERE display_name IS NULL
    """)
    op.execute("""
        ALTER TABLE users ALTER COLUMN display_name SET NOT NULL
    """)

def downgrade() -> None:
    op.drop_column('users', 'display_name')
```

**阶段二**（至少一个版本后）：确认旧代码不再引用旧列，删除旧列

```python
"""Phase 2: Remove old column

Revision ID: 012
"""
revision = '012'
down_revision = '011'

def upgrade() -> None:
    op.drop_column('users', 'nickname')

def downgrade() -> None:
    op.add_column('users', sa.Column('nickname', sa.String(50), nullable=True))
    op.execute("UPDATE users SET nickname = display_name")
```

#### 3.3.3 大表变更（百万级以上）

```python
def upgrade() -> None:
    """大表添加 NOT NULL 列：分步执行"""
    # Step 1: 添加可空列（不锁表）
    op.add_column('answer_records', sa.Column('time_spent_ms', sa.Integer, nullable=True))

    # Step 2: 分批回填数据
    op.execute("""
        DO $$
        DECLARE
            batch_size INT := 5000;
            updated_count INT := 1;
        BEGIN
            WHILE updated_count > 0 LOOP
                UPDATE answer_records
                SET time_spent_ms = 0
                WHERE id IN (
                    SELECT id FROM answer_records
                    WHERE time_spent_ms IS NULL
                    LIMIT batch_size
                );
                GET DIAGNOSTICS updated_count = ROW_COUNT;
                COMMIT;
                -- 每批之间暂停，减少锁争用
                PERFORM pg_sleep(0.1);
            END LOOP;
        END $$;
    """)

    # Step 3: 设置 NOT NULL
    op.execute("ALTER TABLE answer_records ALTER COLUMN time_spent_ms SET NOT NULL")

    # Step 4: 添加默认值
    op.execute("ALTER TABLE answer_records ALTER COLUMN time_spent_ms SET DEFAULT 0")
```

---

## 4. 数据类型变更规范

### 4.1 安全变更矩阵

| 变更类型 | 风险 | 策略 |
|---------|------|------|
| 新增可空列 | 🟢 低 | 直接执行 |
| 新增有默认值的 NOT NULL 列 | 🟡 中 | 先加可空 → 回填 → 改 NOT NULL |
| 扩大字段长度（VARCHAR 50→100） | 🟢 低 | 直接 ALTER |
| 缩小字段长度（VARCHAR 100→50） | 🔴 高 | 先检查截断风险 → 分批更新 |
| 修改数据类型（INT→BIGINT） | 🟡 中 | PG 在线变更，但大表耗时 |
| 删除列 | 🟡 中 | 双阶段（先忽略 → 再删除） |
| 重命名列 | 🔴 高 | 双阶段迁移 |
| 重命名表 | 🔴 高 | 双阶段迁移 + 视图过渡 |
| 添加索引 | 🟡 中 | CONCURRENTLY |
| 添加唯一约束 | 🔴 高 | 先验证数据 → CONCURRENTLY |

### 4.2 索引创建规范

```python
# ✅ 正确：使用 CONCURRENTLY
op.execute(
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_mistake_records_user_subject "
    "ON mistake_records (user_id, subject_id)"
)

# ❌ 错误：直接创建会锁表
# op.create_index('ix_mistake_records_user_subject', 'mistake_records',
#                 ['user_id', 'subject_id'])
```

> **注意**：`CREATE INDEX CONCURRENTLY` 不能在事务块中执行。Alembic 需配置
> `transaction_per_migration=True`，并在 `env.py` 中使用 `op.execute()` 而非
> `op.create_index()`。

---

## 5. 迁移生命周期管理

### 5.1 开发流程

```
开发者修改 Model
       │
       ▼
alembic revision --autogenerate -m "描述变更"
       │
       ▼
检查自动生成的迁移脚本
  - 确认 upgrade() 正确
  - 编写 downgrade()
  - 检查是否需要分步执行
       │
       ▼
本地测试迁移
  - alembic upgrade head
  - alembic downgrade -1
  - alembic upgrade head（验证可重复）
       │
       ▼
编写迁移测试（tests/migrations/）
       │
       ▼
Git Commit + PR Review
```

### 5.2 测试要求

每个迁移必须通过以下测试：

```python
# tests/migrations/test_migration_002.py
import pytest
from alembic import command
from alembic.config import Config


class TestMigration002:
    """测试 migration 002: add user wechat fields"""

    @pytest.fixture(autouse=True)
    def setup(self, alembic_engine, alembic_config):
        """先升级到前一版本"""
        command.upgrade(alembic_config, "001")
        self.engine = alembic_engine
        self.config = alembic_config

    def test_upgrade_adds_columns(self):
        """验证 upgrade 添加了正确的列"""
        command.upgrade(self.config, "002")

        with self.engine.connect() as conn:
            result = conn.execute(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name='users' AND column_name IN "
                "('wechat_openid', 'wechat_unionid')"
            )
            columns = {row[0] for row in result}
            assert 'wechat_openid' in columns
            assert 'wechat_unionid' in columns

    def test_downgrade_removes_columns(self):
        """验证 downgrade 能正确回滚"""
        command.upgrade(self.config, "002")
        command.downgrade(self.config, "001")

        with self.engine.connect() as conn:
            result = conn.execute(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name='users' AND column_name IN "
                "('wechat_openid', 'wechat_unionid')"
            )
            columns = {row[0] for row in result}
            assert 'wechat_openid' not in columns
            assert 'wechat_unionid' not in columns

    def test_idempotent_upgrade(self):
        """验证在目标版本再执行 upgrade 不报错"""
        command.upgrade(self.config, "002")
        # head 已经是 002，再执行不应报错
        command.upgrade(self.config, "002")

    def test_index_created(self):
        """验证索引正确创建"""
        command.upgrade(self.config, "002")

        with self.engine.connect() as conn:
            result = conn.execute(
                "SELECT indexname FROM pg_indexes "
                "WHERE tablename='users' AND indexname='ix_users_wechat_openid'"
            )
            assert result.fetchone() is not None
```

### 5.3 Code Review 检查清单

```markdown
## 迁移脚本 Review 清单

- [ ] revision ID 正确递增
- [ ] down_revision 指向正确的前一版本
- [ ] upgrade() 逻辑正确且安全
- [ ] downgrade() 能完整回滚 upgrade() 的变更
- [ ] 大表变更使用分批操作
- [ ] 索引使用 CONCURRENTLY
- [ ] NOT NULL 列先加可空再改约束
- [ ] 数据迁移有防护（WHERE 条件、LIMIT 批次）
- [ ] 无硬编码的数据库连接或密码
- [ ] 已编写迁移测试
```

---

## 6. 非 PostgreSQL 迁移管理

### 6.1 Elasticsearch 索引迁移

```python
# migrations/elasticsearch/v002_add_question_fulltext.py
"""
ES 索引变更策略：
- 新增字段：直接更新 Mapping（ES 支持）
- 修改字段类型：创建新索引 → Reindex → Alias 切换
- 删除字段：创建新索引 → Reindex（排除该字段）→ Alias 切换
"""
import time
from elasticsearch import Elasticsearch
from app.core.config import settings


def upgrade(es: Elasticsearch) -> None:
    """添加 question 索引的全文检索字段"""

    # 方案一：新增字段（ES 原生支持）
    es.indices.put_mapping(
        index="questions",
        body={
            "properties": {
                "fulltext_content": {
                    "type": "text",
                    "analyzer": "ik_max_word",
                    "search_analyzer": "ik_smart"
                }
            }
        }
    )

    # 方案二：修改字段类型（需要 Reindex）
    new_index = "questions_v2"
    es.indices.create(
        index=new_index,
        body={
            "settings": {
                "number_of_shards": 3,
                "number_of_replicas": 1,
                "analysis": {
                    "analyzer": {
                        "ik_smart_pinyin": {
                            "type": "custom",
                            "tokenizer": "ik_max_word",
                            "filter": ["pinyin_filter", "lowercase"]
                        }
                    },
                    "filter": {
                        "pinyin_filter": {
                            "type": "pinyin",
                            "keep_full_pinyin": True,
                            "keep_original": True
                        }
                    }
                }
            },
            "mappings": {
                "properties": {
                    # ... 完整 Mapping
                }
            }
        }
    )

    # Reindex（异步任务）
    task = es.reindex(
        body={
            "source": {"index": "questions"},
            "dest": {"index": new_index}
        },
        wait_for_completion=False,
    )
    task_id = task["task"]

    # 轮询等待完成
    while True:
        status = es.tasks.get(task_id=task_id)
        if status["completed"]:
            break
        time.sleep(5)

    # 切换 Alias（原子操作）
    es.indices.update_aliases(body={
        "actions": [
            {"remove": {"index": "questions", "alias": "questions_active"}},
            {"add": {"index": new_index, "alias": "questions_active"}},
        ]
    })

    # 旧索引保留 7 天后删除
    # 由定时任务清理
```

### 6.2 ClickHouse 表变更

```python
# migrations/clickhouse/v002_add_session_duration.py
"""
ClickHouse 表变更策略：
- ALTER TABLE ... ADD COLUMN：在线操作，不影响查询
- ClickHouse 不支持事务，需确保幂等
- 大表变更使用 mutations（ALTER ... UPDATE）
"""
from clickhouse_driver import Client


def upgrade(client: Client) -> None:
    """添加学习会话时长字段"""

    # ClickHouse ALTER ADD COLUMN 是在线操作
    client.execute("""
        ALTER TABLE learning_events
        ADD COLUMN IF NOT EXISTS session_duration_ms UInt32 DEFAULT 0
    """)

    # ClickHouse 不支持轻松 DROP COLUMN（某些引擎）
    # 回滚策略：保留列，设置 DEFAULT NULL（通过 Nullable）


def downgrade(client: Client) -> None:
    """ClickHouse 回滚有限制，记录变更日志"""
    # ClickHouse 的 ALTER DROP COLUMN 对 MergeTree 可用但代价高
    # 建议：保留列，标记为 deprecated
    client.execute("""
        ALTER TABLE learning_events
        COMMENT COLUMN session_duration_ms 'DEPRECATED: removed in v003'
    """)
```

### 6.3 Redis 结构变更

```python
# migrations/redis/v002_session_structure.py
"""
Redis 结构变更策略：
- Redis 是 Schema-less，结构变更主要依赖代码适配
- 对于 key 命名变更，使用 SCAN + RENAME 批量操作
- 对于 Hash 字段变更，代码层面兼容新旧格式
"""


def upgrade(redis_client) -> None:
    """Session 结构从 Hash v1 迁移到 v2"""
    cursor = 0
    migrated = 0

    while True:
        cursor, keys = redis_client.scan(
            cursor=cursor, match="session:*", count=100
        )

        for key in keys:
            # 检查是否是旧格式
            version = redis_client.hget(key, "_version")
            if version == b"1" or version is None:
                pipe = redis_client.pipeline()
                # 添加新字段
                pipe.hset(key, "_version", "2")
                pipe.hsetnx(key, "device_info", "{}")
                pipe.hsetnx(key, "last_active_at", "0")
                pipe.execute()
                migrated += 1

        if cursor == 0:
            break

    print(f"Migrated {migrated} session keys to v2")


def downgrade(redis_client) -> None:
    """回滚 session 到 v1 格式"""
    cursor = 0
    while True:
        cursor, keys = redis_client.scan(
            cursor=cursor, match="session:*", count=100
        )
        for key in keys:
            pipe = redis_client.pipeline()
            pipe.hdel(key, "device_info", "last_active_at")
            pipe.hset(key, "_version", "1")
            pipe.execute()
        if cursor == 0:
            break
```

### 6.4 Milvus Collection 变更

```python
# migrations/milvus/v002_add_metadata_field.py
"""
Milvus 变更策略：
- Milvus 不支持修改已有 Collection Schema
- 变更流程：创建新 Collection → 数据迁移 → 切换别名 → 删除旧 Collection
"""
from pymilvus import Collection, CollectionSchema, FieldSchema, DataType, connections


def upgrade(alias: str = "knowledge_vectors") -> None:
    """添加 metadata 字段到知识向量 Collection"""

    connections.connect(host="localhost", port="19530")

    old_col = Collection(alias)

    # 创建新 Collection
    fields = [
        FieldSchema(name="id", dtype=DataType.INT64, is_primary=True, auto_id=True),
        FieldSchema(name="knowledge_id", dtype=DataType.INT64),
        FieldSchema(name="embedding", dtype=DataType.FLOAT_VECTOR, dim=1536),
        FieldSchema(name="content_type", dtype=DataType.VARCHAR, max_length=20),  # 新增
        FieldSchema(name="source_id", dtype=DataType.INT64),                      # 新增
    ]
    schema = CollectionSchema(fields=fields, description="Knowledge vectors v2")
    new_col = Collection(name="knowledge_vectors_v2", schema=schema)

    # 创建索引
    index_params = {
        "metric_type": "COSINE",
        "index_type": "IVF_FLAT",
        "params": {"nlist": 1024}
    }
    new_col.create_index(field_name="embedding", index_params=index_params)

    # 数据迁移（搜索 + 插入）
    old_col.load()
    results = old_col.query(
        expr="id >= 0",
        output_fields=["id", "knowledge_id", "embedding"]
    )

    if results:
        insert_data = [
            [r["knowledge_id"] for r in results],
            [r["embedding"] for r in results],
            ["unknown"] * len(results),      # content_type 默认值
            [0] * len(results),               # source_id 默认值
        ]
        new_col.insert(insert_data)

    new_col.load()

    # 切换别名（原子操作）
    from pymilvus import utility
    utility.alter_alias(collection_name="knowledge_vectors_v2", alias=alias)


def downgrade() -> None:
    """回滚：切换回旧 Collection"""
    from pymilvus import utility
    utility.alter_alias(collection_name="knowledge_vectors", alias="knowledge_vectors_active")
    # 旧 Collection 保留不删除，等待确认后手动清理
```

---

## 7. 统一迁移执行器

### 7.1 迁移入口脚本

```python
# scripts/migrate.py
"""
统一迁移入口：执行所有数据库的迁移

用法:
    python scripts/migrate.py --target pg       # 只执行 PostgreSQL
    python scripts/migrate.py --target es       # 只执行 Elasticsearch
    python scripts/migrate.py --target all      # 执行全部（默认）
    python scripts/migrate.py --target pg --to 005  # 迁移到指定版本
    python scripts/migrate.py --target pg --sql  # 只输出 SQL 不执行
"""
import argparse
import logging
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from alembic import command
from alembic.config import Config as AlembicConfig

from app.core.config import settings


logger = logging.getLogger(__name__)


def migrate_postgresql(target_revision: str | None = None, sql_only: bool = False):
    """执行 PostgreSQL 迁移"""
    alembic_cfg = AlembicConfig("alembic/alembic.ini")
    alembic_cfg.set_main_option("sqlalchemy.url", settings.DATABASE_URL)

    if sql_only:
        command.upgrade(alembic_cfg, target_revision or "head", sql=True)
        logger.info("SQL generated for PostgreSQL migrations")
    else:
        current = command.current(alembic_cfg)
        logger.info(f"Current PG revision: {current}")

        command.upgrade(alembic_cfg, target_revision or "head")
        new_current = command.current(alembic_cfg)
        logger.info(f"PG migrated to: {new_current}")


def migrate_elasticsearch():
    """执行 Elasticsearch 迁移"""
    from elasticsearch import Elasticsearch
    from migrations.elasticsearch import get_pending_migrations, record_migration

    es = Elasticsearch(settings.ES_URL)

    pending = get_pending_migrations(es)
    logger.info(f"ES: {len(pending)} pending migrations")

    for migration in pending:
        logger.info(f"Executing ES migration: {migration.name}")
        migration.upgrade(es)
        record_migration(es, migration.name, migration.version)
        logger.info(f"ES migration {migration.name} completed")


def migrate_clickhouse():
    """执行 ClickHouse 迁移"""
    from clickhouse_driver import Client
    from migrations.clickhouse import get_pending_migrations, record_migration

    client = Client(
        host=settings.CLICKHOUSE_HOST,
        port=settings.CLICKHOUSE_PORT,
        database=settings.CLICKHOUSE_DATABASE,
    )

    pending = get_pending_migrations(client)
    logger.info(f"ClickHouse: {len(pending)} pending migrations")

    for migration in pending:
        logger.info(f"Executing CH migration: {migration.name}")
        migration.upgrade(client)
        record_migration(client, migration.name, migration.version)
        logger.info(f"CH migration {migration.name} completed")


def migrate_redis():
    """执行 Redis 迁移"""
    import redis
    from migrations.redis import get_pending_migrations, record_migration

    r = redis.from_url(settings.REDIS_URL)

    pending = get_pending_migrations(r)
    logger.info(f"Redis: {len(pending)} pending migrations")

    for migration in pending:
        logger.info(f"Executing Redis migration: {migration.name}")
        migration.upgrade(r)
        record_migration(r, migration.name, migration.version)
        logger.info(f"Redis migration {migration.name} completed")


def migrate_milvus():
    """执行 Milvus 迁移"""
    from migrations.milvus import get_pending_migrations, record_migration

    pending = get_pending_migrations()
    logger.info(f"Milvus: {len(pending)} pending migrations")

    for migration in pending:
        logger.info(f"Executing Milvus migration: {migration.name}")
        migration.upgrade()
        record_migration(migration.name, migration.version)
        logger.info(f"Milvus migration {migration.name} completed")


TARGETS = {
    "pg": [migrate_postgresql],
    "es": [migrate_elasticsearch],
    "ch": [migrate_clickhouse],
    "redis": [migrate_redis],
    "milvus": [migrate_milvus],
    "all": [migrate_postgresql, migrate_elasticsearch, migrate_clickhouse,
             migrate_redis, migrate_milvus],
}


def main():
    parser = argparse.ArgumentParser(description="PrimeTop Database Migration Runner")
    parser.add_argument("--target", choices=list(TARGETS.keys()), default="all",
                        help="Migration target")
    parser.add_argument("--to", dest="revision", default=None,
                        help="Target revision (PG only)")
    parser.add_argument("--sql", action="store_true",
                        help="Generate SQL only, no execution (PG only)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Show pending migrations without executing")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")

    logger.info(f"Starting migration: target={args.target}")

    if args.target == "pg" and args.revision:
        migrate_postgresql(target_revision=args.revision, sql_only=args.sql)
    else:
        for func in TARGETS[args.target]:
            try:
                func()
            except Exception as e:
                logger.error(f"Migration failed: {func.__name__}: {e}")
                sys.exit(1)

    logger.info("All migrations completed successfully")


if __name__ == "__main__":
    main()
```

---

## 8. 种子数据管理

### 8.1 种子数据分类

| 类型 | 说明 | 示例 | 管理 |
|------|------|------|------|
| 系统种子 | 系统运行必须的初始数据 | 学科列表、角色权限、系统配置 | Alembic data migration |
| 内容种子 | 业务内容初始数据 | 教材版本、知识点树、示例题目 | 独立 seed 脚本 |
| 测试种子 | 开发/测试环境数据 | 测试用户、模拟学习记录 | Factory fixture |

### 8.2 系统种子数据脚本

```python
# scripts/seed.py
"""
种子数据执行器

用法:
    python scripts/seed.py --type system     # 系统数据
    python scripts/seed.py --type content    # 内容数据
    python scripts/seed.py --type all        # 全部
    python scripts/seed.py --type test       # 测试数据
"""
import argparse
import logging
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.database import SessionLocal
from app.models.subject import Subject
from app.models.textbook import Textbook

logger = logging.getLogger(__name__)


# ============ 系统种子 ============

SYSTEM_SUBJECTS = [
    {"id": 1, "name": "语文", "code": "chinese", "phase": ["primary", "middle", "high"]},
    {"id": 2, "name": "数学", "code": "math", "phase": ["primary", "middle", "high"]},
    {"id": 3, "name": "英语", "code": "english", "phase": ["primary", "middle", "high"]},
    {"id": 4, "name": "物理", "code": "physics", "phase": ["middle", "high"]},
    {"id": 5, "name": "化学", "code": "chemistry", "phase": ["middle", "high"]},
    {"id": 6, "name": "生物", "code": "biology", "phase": ["middle", "high"]},
    {"id": 7, "name": "历史", "code": "history", "phase": ["middle", "high"]},
    {"id": 8, "name": "地理", "code": "geography", "phase": ["middle", "high"]},
    {"id": 9, "name": "政治", "code": "politics", "phase": ["middle", "high"]},
]

SYSTEM_ROLES = [
    {"id": 1, "name": "super_admin", "display_name": "超级管理员"},
    {"id": 2, "name": "content_admin", "display_name": "内容管理员"},
    {"id": 3, "name": "operation_admin", "display_name": "运营管理员"},
    {"id": 4, "name": "viewer", "display_name": "只读管理员"},
]

SYSTEM_CONFIGS = [
    {"key": "ai_daily_limit_free", "value": "10", "type": "int", "description": "免费用户每日AI问答次数"},
    {"key": "photo_daily_limit_free", "value": "5", "type": "int", "description": "免费用户每日拍题次数"},
    {"key": "max_conversation_turns", "value": "20", "type": "int", "description": "单次对话最大轮次"},
    {"key": "content_audit_enabled", "value": "true", "type": "bool", "description": "内容审核开关"},
    {"key": "default_model", "value": "gpt-4o-mini", "type": "string", "description": "默认AI模型"},
]


def seed_system_data():
    """写入系统种子数据（幂等）"""
    db = SessionLocal()
    try:
        # 学科
        for subj_data in SYSTEM_SUBJECTS:
            existing = db.query(Subject).filter(Subject.code == subj_data["code"]).first()
            if not existing:
                subject = Subject(**subj_data)
                db.add(subject)
                logger.info(f"  + Subject: {subj_data['name']}")
            else:
                logger.info(f"  = Subject exists: {subj_data['name']}")

        db.commit()
        logger.info("System seed data completed")
    except Exception as e:
        db.rollback()
        logger.error(f"System seed failed: {e}")
        raise
    finally:
        db.close()


def seed_content_data():
    """写入内容种子数据"""
    # 教材版本、知识点树等基础内容
    # 这些数据量大，通常从 CSV/JSON 文件批量导入
    logger.info("Content seed: skipped (use content import pipeline)")


def seed_test_data():
    """写入测试环境数据"""
    # 通过 Factory 创建测试用户、学习记录等
    logger.info("Test seed: use pytest fixtures instead")


SEED_TYPES = {
    "system": seed_system_data,
    "content": seed_content_data,
    "test": seed_test_data,
    "all": [seed_system_data, seed_content_data],
}


def main():
    parser = argparse.ArgumentParser(description="PrimeTop Seed Data Runner")
    parser.add_argument("--type", choices=list(SEED_TYPES.keys()), default="system")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s [%(levelname)s] %(message)s")

    funcs = SEED_TYPES[args.type]
    if not isinstance(funcs, list):
        funcs = [funcs]

    for func in funcs:
        logger.info(f"Running: {func.__name__}")
        func()

    logger.info("Seed completed")


if __name__ == "__main__":
    main()
```

### 8.3 幂等性原则

所有种子脚本必须幂等：

```python
# ✅ 正确：先查后插
existing = db.query(Subject).filter(Subject.code == code).first()
if not existing:
    db.add(Subject(code=code, name=name))

# ❌ 错误：直接插入可能重复
# db.add(Subject(code=code, name=name))

# ✅ 正确：UPSERT
from sqlalchemy.dialects.postgresql import insert

stmt = insert(Subject).values(**data)
stmt = stmt.on_conflict_do_update(
    index_elements=['code'],
    set_={col: stmt.excluded[col] for col in data if col != 'code'}
)
db.execute(stmt)
```

---

## 9. 回滚策略

### 9.1 回滚等级

| 等级 | 场景 | 操作 | RTO | RPO |
|------|------|------|-----|-----|
| L1 | 单次迁移失败 | Alembic downgrade | <5min | 0 |
| L2 | 多次迁移需整体回退 | 恢复数据库快照 + redo | <30min | 快照时间点 |
| L3 | 数据损坏/误操作 | Point-in-Time Recovery (PITR) | <1h | 最后WAL归档 |
| L4 | 灾难恢复 | 异地备份恢复 | <4h | RPO取决于备份频率 |

### 9.2 L1: 单次迁移回滚

```bash
# 查看当前版本
alembic current

# 回滚一个版本
alembic downgrade -1

# 回滚到指定版本
alembic downgrade 005

# 回滚所有（危险！仅开发环境）
alembic downgrade base
```

### 9.3 L2: 批量回滚

```python
# scripts/rollback.py
"""
批量回滚脚本

用法:
    python scripts/rollback.py --to 005              # 回滚到版本 005
    python scripts/rollback.py --steps 3              # 回滚 3 个版本
    python scripts/rollback.py --last 005 --dry-run   # 预览回滚步骤
"""
import argparse
import sys

from alembic import command
from alembic.config import Config as AlembicConfig

from app.core.config import settings


def rollback(to_revision: str = None, steps: int = None, dry_run: bool = False):
    alembic_cfg = AlembicConfig("alembic/alembic.ini")
    alembic_cfg.set_main_option("sqlalchemy.url", settings.DATABASE_URL)

    current = command.current(alembic_cfg)
    print(f"Current revision: {current}")

    if to_revision:
        target = to_revision
        print(f"Will downgrade to: {target}")
    elif steps:
        target = f"-{steps}"
        print(f"Will downgrade {steps} steps")
    else:
        print("Error: specify --to or --steps")
        sys.exit(1)

    if dry_run:
        print("[DRY RUN] No changes made.")
        # 显示涉及的迁移
        command.history(alembic_cfg, verbose=True)
        return

    # 确认
    confirm = input("Type 'YES' to proceed: ")
    if confirm != "YES":
        print("Cancelled.")
        return

    command.downgrade(alembic_cfg, target)
    new_current = command.current(alembic_cfg)
    print(f"Rolled back to: {new_current}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="PrimeTop Migration Rollback")
    parser.add_argument("--to", dest="revision", help="Target revision")
    parser.add_argument("--steps", type=int, help="Number of steps to rollback")
    parser.add_argument("--dry-run", action="store_true", help="Preview only")
    args = parser.parse_args()

    rollback(to_revision=args.revision, steps=args.steps, dry_run=args.dry_run)
```

### 9.4 L3: Point-in-Time Recovery

```bash
# 1. 停止应用服务，防止新数据写入
systemctl stop primetop-app

# 2. 查找最近的完整备份
pg_backrest --stanza=primetop info

# 3. 恢复到指定时间点
pg_backrest --stanza=primetop --type=time \
    "--target=2026-05-20 10:30:00+08" \
    --target-action=promote restore

# 4. 验证数据
psql -c "SELECT count(*) FROM users;"
psql -c "SELECT count(*) FROM answer_records;"

# 5. 重放该时间点之后的迁移（如果有）
alembic upgrade head

# 6. 启动服务
systemctl start primetop-app
```

### 9.5 备份策略

```yaml
# PostgreSQL 备份配置
backup:
  postgresql:
    tool: pg_backrest
    full_backup:
      schedule: "0 2 * * 0"    # 每周日 02:00 全量
      retention: 4              # 保留 4 个全量
    incremental_backup:
      schedule: "0 2 * * 1-6"  # 每天 02:00 增量
      retention: 7
    wal_archiving:
      enabled: true
      mode: async               # 异步归档，减少写入延迟
    storage:
      type: s3
      bucket: primetop-db-backup
      region: cn-east-1
      encryption: AES-256

  elasticsearch:
    tool: elasticsearch_snapshot
    schedule: "0 3 * * *"       # 每天 03:00
    repository: s3_snapshot
    retention: 30

  redis:
    method: RDB + AOF
    rdb_schedule: "every 15 minutes"
    aof_fsync: everysec

  clickhouse:
    tool: clickhouse-backup
    schedule: "0 4 * * *"       # 每天 04:00
    retention: 14
```

---

## 10. CI/CD 集成

### 10.1 迁移检查流水线

```yaml
# .github/workflows/migration-check.yml
name: Migration Check

on:
  pull_request:
    paths:
      - 'alembic/**'
      - 'migrations/**'
      - 'app/models/**'

jobs:
  check:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_DB: primetop_test
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.12'

      - name: Install deps
        run: pip install -r requirements.txt

      - name: Check migration scripts
        run: |
          # 检查自动生成的迁移是否与模型一致
          alembic check

      - name: Test upgrade
        env:
          DATABASE_URL: postgresql://test:test@localhost/primetop_test
        run: |
          alembic upgrade head

      - name: Test downgrade
        env:
          DATABASE_URL: postgresql://test:test@localhost/primetop_test
        run: |
          alembic downgrade -1
          alembic upgrade head

      - name: Run migration tests
        env:
          DATABASE_URL: postgresql://test:test@localhost/primetop_test
        run: |
          pytest tests/migrations/ -v

      - name: Check for data loss
        run: |
          # 检测危险的迁移操作
          python scripts/check_dangerous_ops.py
```

### 10.2 危险操作检测脚本

```python
# scripts/check_dangerous_ops.py
"""
检查迁移脚本中的危险操作
"""
import os
import re
import sys

DANGEROUS_PATTERNS = [
    (r'op\.drop_table\(', 'DROP TABLE', '🔴 高风险'),
    (r'op\.drop_column\(', 'DROP COLUMN', '🟡 中风险'),
    (r'op\.drop_index\(', 'DROP INDEX', '🟡 中风险'),
    (r'op\.rename_table\(', 'RENAME TABLE', '🔴 高风险'),
    (r'op\.alter_column\(.*nullable=False', 'SET NOT NULL', '🟡 中风险'),
    (r'op\.execute\("ALTER TABLE.*DROP', 'ALTER DROP', '🔴 高风险'),
    (r'TRUNCATE', 'TRUNCATE', '🔴 高风险'),
    (r'DELETE FROM', 'DELETE', '🟡 中风险'),
]


def check_file(filepath: str) -> list[dict]:
    findings = []
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    for pattern, operation, risk in DANGEROUS_PATTERNS:
        matches = re.findall(pattern, content, re.IGNORECASE)
        if matches:
            findings.append({
                "file": os.path.basename(filepath),
                "operation": operation,
                "risk": risk,
                "count": len(matches),
            })
    return findings


def main():
    versions_dir = os.path.join(os.path.dirname(__file__), '..', 'alembic', 'versions')
    versions_dir = os.path.abspath(versions_dir)

    if not os.path.exists(versions_dir):
        print("No migrations directory found")
        return

    all_findings = []
    for filename in sorted(os.listdir(versions_dir)):
        if filename.endswith('.py'):
            filepath = os.path.join(versions_dir, filename)
            findings = check_file(filepath)
            all_findings.extend(findings)

    if not all_findings:
        print("✅ No dangerous operations detected")
        return

    print("⚠️  Dangerous operations detected:")
    for f in all_findings:
        print(f"  {f['risk']} {f['file']}: {f['operation']} (x{f['count']})")

    # 检查是否有高危险且无注释说明的
    has_unsafe = any(f['risk'].startswith('🔴') for f in all_findings)
    if has_unsafe:
        print("\n❌ High-risk operations found. Ensure PR has explicit approval.")
        sys.exit(1)


if __name__ == "__main__":
    main()
```

### 10.3 生产部署流程

```
CI/CD Pipeline
      │
      ├─ 1. 迁移检查（PR 合并时自动）
      │     - alembic check
      │     - 危险操作检测
      │     - 迁移测试
      │
      ├─ 2. 构建 Docker 镜像
      │
      ├─ 3. 部署到 Staging
      │     - 执行迁移
      │     - 运行烟雾测试
      │     - 验证数据完整性
      │
      ├─ 4. 灰度发布到生产（10% → 50% → 100%）
      │     - 每阶段执行前自动备份
      │     - 监控错误率/延迟
      │     - 异常自动回滚
      │
      └─ 5. 部署后验证
            - 数据库连接池状态
            - 核心接口成功率
            - 监控告警
```

---

## 11. 迁移执行操作手册

### 11.1 常用命令速查

```bash
# 查看状态
alembic current                    # 当前版本
alembic history                    # 迁移历史
alembic history -r 005:head        # 指定范围历史

# 创建迁移
alembic revision -m "描述"          # 空迁移模板
alembic revision --autogenerate -m "描述"  # 自动检测模型变更

# 执行迁移
alembic upgrade head               # 升级到最新
alembic upgrade +2                  # 升级 2 个版本
alembic upgrade 005                 # 升级到指定版本

# 回滚
alembic downgrade -1               # 回滚 1 个版本
alembic downgrade 005              # 回滚到指定版本

# 生成 SQL
alembic upgrade head --sql         # 输出 SQL 不执行

# 检查
alembic check                      # 检查模型与迁移一致性
```

### 11.2 生产环境迁移执行 SOP

```markdown
## 生产迁移执行步骤

### 前置检查
- [ ] 确认迁移脚本已在 Staging 环境验证
- [ ] 确认最近一次数据库备份已完成且可恢复
- [ ] 确认回滚方案已文档化
- [ ] 确认低峰期执行（建议 02:00-05:00）
- [ ] 确认至少 2 人 review

### 执行步骤
1. 通知相关方："即将执行数据库迁移，预计耗时 X 分钟"
2. 执行备份（如未自动）
   ```bash
   pg_backrest --stanza=primetop backup --type=full
   ```
3. 确认应用健康
   ```bash
   curl -s http://localhost:8000/health | jq .
   ```
4. 执行迁移（使用脚本）
   ```bash
   python scripts/migrate.py --target pg 2>&1 | tee /tmp/migration-$(date +%Y%m%d-%H%M%S).log
   ```
5. 验证数据完整性
   ```bash
   psql -c "SELECT count(*) FROM users;"
   psql -c "SELECT count(*) FROM questions;"
   alembic current
   ```
6. 验证应用功能
   ```bash
   curl -s http://localhost:8000/health
   ```
7. 监控 15 分钟，关注错误率和延迟

### 回滚方案
- L1 回滚：`python scripts/rollback.py --to PREVIOUS_REVISION`
- L2 回滚：恢复备份 → 重做已确认的迁移
- L3 回滚：PITR 恢复到迁移前时间点

### 完成后
- [ ] 更新变更日志
- [ ] 通知相关方迁移完成
- [ ] 保留执行日志 30 天
```

---

## 12. 迁移版本登记表

| 版本 | 描述 | 日期 | 作者 | 影响范围 |
|------|------|------|------|----------|
| 001 | 初始化 Schema | - | - | 全部表 |
| 002 | 用户微信字段 | - | - | users |
| 003 | ... | | | |

> 此表由开发者在提交迁移时手动维护，与 `alembic history` 互为补充。

---

## 13. 注意事项与最佳实践

1. **禁止修改已发布迁移**：一旦迁移脚本合并到 main 分支，绝不修改。需要修正时，新建迁移脚本。
2. **每个迁移只做一件事**：一个迁移脚本只包含一个逻辑变更，避免混合多个不相关变更。
3. **先加后删**：添加新列/表后至少过一个版本再删除旧列/表，确保新旧代码兼容。
4. **大表操作分批**：百万行以上表的 UPDATE/DELETE 必须分批执行，每批 5000 行，间隔 100ms。
5. **索引使用 CONCURRENTLY**：所有索引创建/重建使用 `CONCURRENTLY` 避免锁表。
6. **downgrade 必须完整**：每个 `upgrade()` 必须有对应的 `downgrade()`，生产环境可能需要回滚。
7. **迁移测试必须覆盖**：每个迁移脚本至少包含 upgrade、downgrade、幂等性三个测试。
8. **生产迁移必须备份**：任何生产环境迁移执行前必须确认备份可用。
9. **避免数据丢失**：删除列/表前确认没有代码引用，且数据已归档或不再需要。
10. **使用环境变量**：数据库连接信息不硬编码，通过环境变量或配置中心注入。