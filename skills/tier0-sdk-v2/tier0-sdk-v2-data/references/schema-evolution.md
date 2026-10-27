# Schema 演进

Preview 与部署后的 App 共用集合，较旧的部署版本随时可能用它的旧声明冷启动。因此 ensure 只会**放宽**：存储是所有运行过的声明的并集，每个版本的写入都保持有效。按变更类型选择做法：

| 变更 | 做法 |
| --- | --- |
| 新增可选字段（任意层级，含数组元素内）、新增枚举值、字段改为可选、`int` → `number`、放宽或去掉 `min`/`max`、新增索引 | 修改声明；下次访问时 ensure 生效 |
| 修改 `.describe()` 文本或集合 `description` | 修改声明，然后通过 tier0 MCP 执行 `schema:replace`，请求体用 `compileCollection(declaration)` 的结果（先 `dryRun`：期望 `widened`；`narrowed` 说明存储里还有该声明之外的内容，例如其他版本的字段——合并进请求体或停止）。ensure 保留已存储的描述并报告 `ANNOTATION_NOT_APPLIED`；新字段和新集合在创建时带上描述 |
| 新增每条记录都必须有的字段 | 先以 `.optional()` 加入，所有写入路径都写它，回填旧记录，等部署版本也写入后再用 `schema:replace` 改为必填 |
| 删除或重命名字段 | 代码不再使用旧字段（它可以留在存储里）；新名字就是新的可选字段。通过 tier0 MCP 一次性回填（`records:updateMany` 配 `$rename` / `$set`） |
| 修改字段类型 | 换一个新字段名，回填，读取时以旧字段兜底。ensure 从不转换类型（`SCHEMA_CONFLICT`） |
| 删除枚举值、可选改必填、从存储删除字段、删除索引、收紧 `min`/`max` | 只能在部署版本不再写旧形态之后：通过 tier0 MCP `schema:replace`，先 `dryRun` |

不要为了“重置” Schema 而 `deleteMany` 或重建集合：部署版本的数据会一起丢失。修改 `seed` 不会重新写种子。

## 运行时代码与 worker 操作的边界

`schema:replace`、`archive`、`restore` 由 worker 通过 tier0 MCP 显式执行（`/uns/app/collections/schema:replace`、`archive`、`restore`），App 运行时代码不调用。数据层导出的 `compileCollection(declaration)` 给出与运行时 ensure 完全一致的条目 `{ alias, recordSchema, indexes, description? }`，可作为 ensure `dryRun` 或 `schema:replace` 请求体的基础。

```ts
import { z } from 'zod';
import { compileCollection, defineCollection } from '@tier0/sdk-v2/data';

const tickets = defineCollection({
  alias: 'tickets',
  schema: z.object({ title: z.string().describe('Short summary'), severity: z.enum(['LOW', 'HIGH']).optional() }),
});

/** schema:replace 请求体的基础；expectedRevision 取自 ensure 结果的集合 revision。 */
export function replaceBody(expectedRevision: number) {
  const { alias, recordSchema, indexes } = compileCollection(tickets);
  return { alias, recordSchema, indexes, expectedRevision, dryRun: true };
}
```

Schema 中 `ignored`、`warnings`、`conflicts`、`violations` 的路径用 `.` 连接属性，用 `[]` 表示数组元素（`lines.[].qty`）。

新声明的 number/integer 默认带 double/int32 格式；ensure 不改写已有字段注解，原无格式字段仍保持 legacy 显示。已有字段格式迁移需读取并保留完整 Schema，先通过 schema:replace dryRun 检查，再按明确迁移授权执行。
