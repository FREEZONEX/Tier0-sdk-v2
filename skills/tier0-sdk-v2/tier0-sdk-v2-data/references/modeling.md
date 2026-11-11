# Collection 建模

每种需要独立持久化和查询的业务实体一个集合。随实体一起修改的有界明细可嵌入文档；共享对象按 ID 引用并按需要保存展示快照。列表统计尽量在服务端聚合，避免逐条读取关联数据。

## 声明或引用

```ts
import { z } from 'zod';
import { defineCollection, type Doc } from '@tier0/sdk-v2/data/define';

export const orders = defineCollection({
  alias: 'orders', name: '销售订单', directoryPath: ['销售管理'],
  schema: z.object({
    code: z.string(), status: z.enum(['DRAFT', 'CONFIRMED', 'CANCELLED']),
    customer: z.object({ id: z.string(), name: z.string() }),
    lines: z.array(z.object({ sku: z.string(), qty: z.number().int().min(1).meta({ format: 'int32' }) })),
    notes: z.string().optional(),
  }),
  indexes: [{ path: 'code', unique: true }, { path: 'status' }, { path: 'lines', kind: 'gin' }],
});
export type Order = Doc<typeof orders>;
```

name 是展示的业务名称（1–63 字符，无首尾空白、斜杠或 NUL），alias 是稳定程序标识，匹配 `^[A-Za-z][A-Za-z0-9_-]{0,62}$`、App 内不区分大小写唯一。ensure 保留已有 alias 的名称、ID 和目录，改名使用元数据更新。

```ts
import { createDataClient } from '@tier0/sdk-v2/data';

const data = createDataClient({});
export const inventory = data.collection<{ sku: string; available: number }>({
  collectionId: 'existing-inventory-id',
});
```

已有 ID 引用不加入声明数组，不需要 alias；可选 schema 用于本地写入校验，省略则由服务端校验。该引用也可用于 queryBatch/transact/subscribe，不建集合、种子或授权。

## 按实际业务范围声明目录

新集合 directoryPath 从 Workspace 根开始，1–16 个名称，每段 1–63 字符，不含 `/`、NUL 或首尾空白。工业场景复用已知 ISA-95 企业/工厂/车间/工作中心/工作单元，只声明实际需要的已知层级；允许在实际范围下放 MES 业务模块。共享数据放在共同祖先，非工业业务用自己的目录。

ensure 同事务复用或创建目录、集合和授权，不需要先 metadataInsertOne。路径被归档目录或非目录对象占用返回 DIRECTORY_PATH_CONFLICT；已有 alias 的路径变化返回 DIRECTORY_PATH_NOT_APPLIED，不自动移动。目录不决定所属 App 或共享权限。

## 存储 Schema

使用 Zod 4 的闭合对象、string、number/integer（可带 min/max）、boolean、enum、array、嵌套对象和 optional。nullable、union、default、transform、pattern、字符串长度等不属于可存储子集，放在 API 入参验证里。嵌套最多 8 层，每对象最多 128 属性，每枚举最多 100 值；枚举值需符合该字段数值范围。

| 类型 | Zod | 原始 Schema |
| --- | --- | --- |
| 整数 | z.number().int().meta({format:'int32'}) | integer + int32 |
| 普通小数 | z.number().meta({format:'double'}) | number + double |
| 单精度注解 | z.number().meta({format:'float'}) | number + float |
| 时间字符串注解 | z.string().meta({format:'date-time'}) | string + date-time |

格式仅为注解，不转换或舍入、不保证位宽或日期字符串合法。SDK 对未标注整数/小数补 int32/double；原始 MCP 请求自行提供格式。真实日期验证可放在输入 schema 的 z.iso.datetime()，不要把带 pattern 的输入 Schema 直接当集合 Schema。

写入按声明严格校验，读取可能含其他版本新增字段、枚举或缺少后来加入的字段，不做严格解析；页面须兼容这些情况。

## 索引

使用 `{path}` 或最多 3 字段的 `{paths}`；业务唯一键加 unique:true；数组/对象可用单字段 kind:'gin'，不能 unique。路径沿对象属性，不直接索引数组元素里的属性；每集合最多 16 个索引，实际配额以服务端为准。过滤和排序常用字段应考虑索引。

唯一索引异步创建，ready 后才可依赖唯一约束或 upsert。upsert 要求 _id 等值或一个 ready 唯一索引全部字段等值。软删除记录释放唯一键，恢复可能与活动记录冲突。

### 过期自动删除（TTL）

索引 `{path:'issuedAt',expireAfterSeconds:300}` 配合 integer 字段存 Unix 毫秒。每集合最多一个、单字段、非唯一 btree；60–31536000 秒，缺字段的记录不清理，Source 管理集合不支持 TTL。

TTL 物理删除记录及关联 Sample，不能恢复，清理有延迟，业务读取仍判断过期时间。ensure 可新增/延长，缩短/移除需显式结构替换。集合回收后停止 TTL；保留索引仍占配额。

## 种子数据

seed 是新集合的基线记录，使用固定 _id，最多 1000 条。只在 ensure 报告 created 时按原子分块写入；修改 seed 或列表为空不会重新播种。构建时可用 validateDocument 检查种子。Preview 和部署共享数据，不通过删集合“重置”种子。
