# 声明集合与建模

`defineCollection({ alias, schema, indexes?, description?, seed? })` 返回冻结的声明；全部声明放进一个数组传给 `createDataClient({ collections })`。声明文件从 `@tier0/sdk-v2/data/define` 导入：它不含数据运行时，组件和 route 也能引用这些声明与 `Doc` 类型。alias 在 App 内唯一、不区分大小写，匹配 `^[A-Za-z][A-Za-z0-9_-]{0,62}$`。

```ts
import { z } from 'zod';
import { defineCollection, type Doc } from '@tier0/sdk-v2/data/define';

export const customers = defineCollection({
  alias: 'customers',
  schema: z.object({ name: z.string(), tier: z.enum(['A', 'B', 'C']) }),
  indexes: [{ path: 'name' }],
  seed: [
    { _id: 'cust-1', name: 'Acme', tier: 'A' },
    { _id: 'cust-2', name: 'Globex', tier: 'B' },
  ],
});

export const salesOrders = defineCollection({
  alias: 'sales_orders',
  description: 'Customer sales orders',
  schema: z.object({
    code: z.string(),
    status: z.enum(['DRAFT', 'CONFIRMED', 'SHIPPED', 'CANCELLED']),
    customer: z.object({ id: z.string(), name: z.string() }),
    lines: z.array(z.object({ sku: z.string(), qty: z.number().int().min(1) })),
    notes: z.string().optional(),
    orderedOn: z.string().describe('YYYY-MM-DD'),
    confirmedAt: z.string().optional().describe('ISO-8601 UTC from toISOString()'),
  }),
  indexes: [{ path: 'code', unique: true }, { paths: ['status', 'orderedOn'] }, { path: 'lines', kind: 'gin' }],
  seed: [
    { _id: 'so-1', code: 'SO-1', status: 'DRAFT', customer: { id: 'cust-1', name: 'Acme' }, lines: [], orderedOn: '2026-01-05' },
  ],
});
export type SalesOrder = Doc<typeof salesOrders>;

export const collections = [customers, salesOrders] as const;

// API 入参 Schema 从声明派生，再追加输入规则。
export const createSalesOrderInput = salesOrders.schema
  .omit({ status: true, confirmedAt: true })
  .extend({ code: z.string().trim().min(1).max(32) });
```

## 可存储的 Zod 子集

集合 Schema 会转成 UNS 记录 Schema 子集；不能存储的写法在 `compileCollection` / 首次 ensure 时抛 `CollectionSchemaError`，并给出替代写法。

| 使用 | 不要用 |
| --- | --- |
| `z.string()`、`z.number()`、`z.number().int()`、`z.boolean()` | `z.date()`、`z.bigint()`、`z.any()`、`z.unknown()` |
| 数字上的 `.min()` / `.max()`（闭区间） | `.positive()`、`.gt()`、`.lt()`、`.multipleOf()` |
| `z.enum([...])` | `z.literal()`、union、`.nullable()`、`.nullish()` |
| `.optional()`（字段可缺省） | 存 `null`：不写该字段，清空用 `$unset` |
| `z.object({...})`（始终封闭）、`z.array(item)` | `z.record()`、`z.looseObject()`、`.catchall()`、`z.tuple()` |
| 普通 `z.string()`，格式与长度在 API 入参校验 | `z.email()`、`z.uuid()`、`.regex()`、字符串 `.min(1)` |
| 在 service 里补默认值 | `.default()`、`.catch()`、`.transform()` |

日期存 `"YYYY-MM-DD"` 字符串，时刻存 `toISOString()` 的 ISO-8601 UTC 字符串，两者都能按字符串排序和范围过滤。`_id` 与 `_meta`（`revision`、`createdAt`、`updatedAt`，Unix 毫秒）是系统字段，不要声明。

限制：对象最多嵌套 8 层、每个对象 128 个属性、每个字段 100 个枚举值；`.describe()` 最多 2048 个 UTF-8 字节（约 680 个汉字）；集合 `description` 最多 512 个字符。字段与集合描述只在首次创建时写入，之后修改要走 `schema:replace`（见 [Schema 演进](schema-evolution.md)）。

## 索引

`{ path }` 或复合 `{ paths }`（最多 3 个不同路径）；业务键加 `unique: true`；一个数组/对象字段用 `kind: 'gin'`；每个集合最多 16 个。路径只能沿对象属性走：数组元素里的字段（`lines.sku`）不能直接建索引，改为给 `lines` 建 GIN 或把值放到顶层字段。列表页过滤和排序用到的字段要建索引。

### 过期自动删除（TTL）

会话、验证码、临时预约这类到期就该消失的记录，用 TTL 索引让 UNS 自动删除，不要写定时清理任务：

```ts
import { z } from 'zod';
import { defineCollection } from '@tier0/sdk-v2/data/define';

export const loginCodes = defineCollection({
  alias: 'login_codes',
  schema: z.object({ phone: z.string(), code: z.string(), issuedAt: z.number().int() }),
  // issuedAt 存 Date.now()；签发 5 分钟后删除。
  indexes: [{ path: 'phone' }, { path: 'issuedAt', expireAfterSeconds: 300 }],
});
```

- 字段声明为 `z.number().int()`，存 Unix 毫秒（通常是 `Date.now()`）；记录在该时刻再过 `expireAfterSeconds`（60–31536000 秒）后被删除。删除有分钟级延迟，读取时仍要自己比较时间。
- 每个集合最多 1 个 TTL 索引，只能是单个 `path`、不能 `unique`。缺这个字段的记录不会过期。
- 过期删除是**物理删除**，不能 restore；软删除的记录同样按 TTL 清理。
- ensure 只能新增 TTL 或把时间加长；缩短或去掉要通过 tier0 MCP 的 `schema:replace`。

## 种子数据

种子是基线记录：固定 `_id`，各生命周期状态自洽，相互引用用这些 ID；每个集合最多 1000 条。只在 ensure 报告集合为 `created` 时写入一次（每 200 条一个原子分块，分块带固定幂等键，重试安全）；修改 `seed` 不会改动已存在的集合。不要在服务启动或列表为空时从代码插入基线数据。构建期可以对每条种子调用 `validateDocument(definition, document)` 校验。

## 按文档建模，而不是按表

- 属于同一记录、随它一起变化的内容（订单行、检查步骤、审批历史）嵌在该文档的数组里，一次写入保持一致；数组保持有界。
- 共享实体按 ID 引用，并快照需要展示的字段（`customer: { id, name }`），不要在读取时 join。`aggregate` 有 `$lookup`，但有行数限制，不要用它搭列表页。
- 每种业务对象一个集合，而不是每个页面一个集合。
- “最新优先”用 `_meta.createdAt` / `_meta.updatedAt`，由 UNS 维护。
