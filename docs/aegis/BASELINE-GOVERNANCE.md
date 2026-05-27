# Baseline Governance

## 1. Architecture Defect

确认是基线本身错了，先修基线，再让实现回到修正后的基线。

不要为了绕过错误基线，在实现里继续堆补丁。

## 2. Architecture Drift

实现偏离了正确基线，优先回归基线。

不要因为代码已经漂了，就反过来把漂移写成新的基线。

## 3. Owner Boundary

新增能力要先确认 owner。

如果一个文件已经承担过多职责，不应继续往里堆新逻辑，而应抽出新的 owner。

## 4. Compatibility Boundary

兼容路径必须明确标注保留原因和退役触发条件。

如果当前任务不要求兼容，就不要预埋多余兼容层。
