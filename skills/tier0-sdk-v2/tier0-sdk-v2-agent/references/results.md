# Agent 结果与并发编辑

## 按原意图查回保存结果

```ts
import { createClient, type Tier0Client } from '@tier0/sdk-v2';

type SaveInput = Parameters<Tier0Client['agent']['results']['create']>[0];
export async function saveResult(input: SaveInput) {
  return createClient().agent.results.create(input);
}
export async function reconcileResult(operationId: string) {
  return createClient().agent.results.get({ operationId });
}
```

保存必填 resultSchemaVersion/title/missingData/operationId/source；source 至少含 platformSessionId/agentId。版本和 manifest 字段以实际业务契约为准。保存前持久化 operationId；结果未知时按同一个 operationId 查回，禁止换 ID 重复创建。

results.get 的 resultId 与 operationId 二选一。results.pin({ resultId, canvasId }) 是写操作，canvasId 从 canvases.list 取得，不能因查看结果而自动固定到画布。

## 卡片乐观并发

```ts
import { createClient, type Tier0Client } from '@tier0/sdk-v2';

type CardUpdate = Parameters<Tier0Client['agent']['cards']['update']>[0];
export async function submitCardEdit(input: CardUpdate) {
  // expectedCardSpec 是读取时的完整原值，cardSpec 是编辑后的新值。
  return createClient().agent.cards.update(input);
}
type LibraryUpdate = Parameters<Tier0Client['agent']['library']['update']>[0];
export async function submitLibraryEdit(input: LibraryUpdate) {
  return createClient().agent.library.update(input);
}
```

cardId/cardSpec/expectedCardSpec 必填；ord 省略表示不改，不能为了凑参数默认传 0。资料库更新要求 libraryItemId、expectedItem、cardSpec，expectedItem 包括原 cardKey/cardSpec/tags/sourceSessionId。

409 时重新读取并展示冲突，保留用户本次编辑意图后再合并。不要用刚读的新内容填充 expected*，却仍提交覆盖别人修改的旧全文。

## 作业查询与触发边界

jobs.trigger 回执中的 jobRunId 用于 jobRuns.get；dispatchState 不是执行结果。查询列表可以按业务需要有界轮询，不自动再次触发。更新 notifyEnabled=2 时省略 notify；notifyEnabled=1 时提供当前认可的通知结构。

nodes.indexSync 会改变索引状态，relations.teach 会新增关系；用户只要搜索或查关系列表时分别用 searchSemantic 和 relations.list。
