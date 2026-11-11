# Schema 演进

JSONB 存储仍受 Schema、索引和 Topic 字段引用约束。ensure 只放宽，允许预览与旧部署的声明同时使用同一集合；它不迁移、转换或清空记录。

| 改动 | 做法 |
| --- | --- |
| 新可选字段、扩展枚举、改可选、int → number、放宽范围、新索引 | 修改声明，由下次 ensure 合并 |
| 改业务名称或目录 | 元数据更新；ensure 保留现有名称/目录，路径差异报告 DIRECTORY_PATH_NOT_APPLIED |
| 改描述/注解 | 显式 schema:replace；ensure 保留旧值并报告 ANNOTATION_NOT_APPLIED |
| 新增必填字段 | 先可选，部署写入逻辑、回填旧记录，再验证并收紧 |
| 重命名或改变字段类型 | 新字段与旧字段兼容读写，回填后再决定是否移除旧结构 |
| 删除字段/枚举/索引、收紧范围、缩短或移除 TTL | 显式 schema:replace，检查存量数据和旧写入方 |

## 显式结构替换

通过管理流程调用 `/uns/app/collections/schema:replace`，传 alias、完整 recordSchema/indexes、当前 expectedRevision，可带 description。不要把 ensure 声明里的 name/directoryPath 发送到该入口。

```ts
import { compileCollection, type CollectionDefinition } from '@tier0/sdk-v2/data';

// 具体声明由应用导入；从编译结果只取替换接口需要的字段。
export function replacement(declaration: CollectionDefinition, expectedRevision: number) {
  const { alias, recordSchema, indexes, description } = compileCollection(declaration);
  return { alias, recordSchema, indexes, description, expectedRevision, dryRun: true };
}
```

可用 dryRun 查看 unchanged/widened/narrowed 和 warnings。收窄会验证已有记录：SCHEMA_DATA_VIOLATION 返回违规位置，SCHEMA_MIGRATION_TOO_LARGE 表示超过扫描限额，REFERENCED 表示字段仍被引用。通过校验才提交，不自动修改记录值；收窄后旧版本写入可能被拒绝。

普通 metadataUpdateOne 的 $set.recordSchema 同样替换完整 Schema，但集合有数据时仅接受兼容放宽，不能把它当绕过存量校验的入口。revision 冲突重新读取比较，不自动覆盖。

修改 seed 不重写种子；删除记录会影响同一集合的预览与部署，并物理删除关联 Sample。归档与恢复见 [回收规则](../../tier0-sdk-v2-uns/references/delete.md#回收规则)。
