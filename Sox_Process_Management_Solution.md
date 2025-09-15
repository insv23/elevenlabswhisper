# Sox 进程管理重构方案

## 问题背景

当前 ElevenLabs Whisper 扩展存在重复启动 sox 录音进程的问题：
- 多个 sox 进程同时运行
- 录音文件被多个进程同时写入
- 停止录音时只能关闭其中一个进程
- 需要使用 `lsof` 查找并强制杀死残留进程

## 根本原因分析

### 1. 状态管理分离问题
- UI 状态（`useTranscription` hook）与进程状态（`AudioService`）分离
- 状态转换不是原子操作
- 缺少对并发操作的保护机制

### 2. 自动录音逻辑缺陷
```typescript
// 问题代码位置：src/transcribe.tsx
useEffect(() => {
  if (state.status === "idle" && !missingPrefReason) {
    startRecording(); // 可能重复触发
  }
}, [state.status, missingPrefReason, startRecording]);
```

### 3. 进程生命周期管理不当
- 只通过 `this.proc` 判断录音状态
- 进程启动和状态更新不同步
- 依赖外部工具（`lsof`）进行进程清理

## 解决方案架构

### 核心设计原则

1. **单一数据源**：AudioService 完全掌控录音状态
2. **原子操作**：状态变更与进程操作必须同步进行
3. **显式状态机**：明确定义所有状态和合法转换路径
4. **内部资源管理**：摆脱对外部工具的依赖

### 状态机设计

```typescript
enum RecordingState {
  UNINITIALIZED = 'uninitialized',  // Sox 路径未解析
  IDLE = 'idle',                     // 就绪状态，可以开始录音
  STARTING = 'starting',             // 正在启动 sox 进程
  RECORDING = 'recording',           // 正在录音
  STOPPING = 'stopping',             // 正在停止 sox 进程
  TRANSCRIBING = 'transcribing',     // 正在转录音频
  SUCCESS = 'success',               // 转录完成
  ERROR = 'error'                    // 发生错误
}

// 状态转换规则
const VALID_TRANSITIONS: Record<RecordingState, RecordingState[]> = {
  UNINITIALIZED: [IDLE, ERROR],
  IDLE: [STARTING],
  STARTING: [RECORDING, ERROR],
  RECORDING: [STOPPING, ERROR],
  STOPPING: [TRANSCRIBING, ERROR],
  TRANSCRIBING: [SUCCESS, ERROR],
  SUCCESS: [IDLE],
  ERROR: [IDLE]
};
```

### 新的 AudioService 架构

```typescript
export class AudioService {
  private state: RecordingState = RecordingState.UNINITIALIZED;
  private soxPath: string | null = null;
  private proc: ChildProcessWithoutNullStreams | null = null;
  private currentRecordingPath: string | null = null;
  private stateListeners = new Set<(state: RecordingState) => void>();
  private transitionLock = false;

  // 状态管理方法
  getState(): RecordingState
  subscribe(listener: (state: RecordingState) => void): () => void
  private async transitionTo(newState: RecordingState): Promise<void>
  
  // 生命周期方法
  async initialize(): Promise<void>
  async start(): Promise<string>
  async stop(): Promise<string>
  async cancel(): Promise<void>
  
  // 内部方法
  private cleanup(): void
  private handleProcessError(error: Error): Promise<void>
}
```

### 状态转换保护机制

```typescript
private async transitionTo(newState: RecordingState): Promise<void> {
  // 防止并发状态转换
  if (this.transitionLock) {
    throw new Error('State transition in progress');
  }
  
  // 验证转换合法性
  const validNextStates = VALID_TRANSITIONS[this.state];
  if (!validNextStates.includes(newState)) {
    throw new Error(
      `Invalid transition: ${this.state} -> ${newState}`
    );
  }

  this.transitionLock = true;
  try {
    this.state = newState;
    this.notifyListeners();
  } finally {
    this.transitionLock = false;
  }
}
```

### 改进的 Hook 设计

```typescript
export function useTranscription() {
  const [state, setState] = useState(() => ({
    status: audioService.getState(),
  }));

  useEffect(() => {
    // 订阅 AudioService 状态变化
    const unsubscribe = audioService.subscribe((newState) => {
      setState(prev => ({ ...prev, status: newState }));
    });

    // 初始化服务
    audioService.initialize().catch(error => {
      setState({ status: 'error', error: error.message });
    });

    return unsubscribe;
  }, []);

  // 简化的操作方法
  const startRecording = useCallback(async () => {
    try {
      await audioService.start();
    } catch (error) {
      // 错误处理由 AudioService 状态机管理
    }
  }, []);

  const stopAndTranscribe = useCallback(async () => {
    try {
      const filePath = await audioService.stop();
      const text = await transcriptionService.transcribe(filePath);
      setState({ status: 'success', transcript: text || '' });
    } catch (error) {
      // 错误处理
    }
  }, []);

  return { state, startRecording, stopAndTranscribe, reset };
}
```

### 组件层面的改进

```typescript
export default function Command() {
  const { state, startRecording, stopAndTranscribe, reset } = useTranscription();
  const [autoStarted, setAutoStarted] = useState(false);

  // 受控的自动启动逻辑
  useEffect(() => {
    if (
      state.status === 'idle' && 
      !autoStarted && 
      !missingPrefReason
    ) {
      setAutoStarted(true);
      startRecording();
    }
  }, [state.status, autoStarted, missingPrefReason, startRecording]);

  // 重置时清除自动启动标记
  const handleReset = useCallback(() => {
    setAutoStarted(false);
    reset();
  }, [reset]);

  // ... 其余组件逻辑
}
```

## 实施计划

### 阶段一：核心状态机实现
- [ ] 定义 `RecordingState` 枚举和转换规则
- [ ] 在 `AudioService` 中实现状态管理
- [ ] 添加状态转换保护机制
- [ ] 实现订阅/通知系统

### 阶段二：进程管理重构
- [ ] 重构 `start()` 方法，添加状态检查
- [ ] 重构 `stop()` 方法，确保进程正确关闭
- [ ] 移除 `lsof` 依赖，使用内部清理机制
- [ ] 添加进程超时和错误处理

### 阶段三：UI 层适配
- [ ] 更新 `useTranscription` hook
- [ ] 修改组件中的自动录音逻辑
- [ ] 确保状态同步和错误处理

### 阶段四：测试与验证
- [ ] 单元测试：状态机转换
- [ ] 集成测试：快速连续操作
- [ ] 压力测试：异常情况处理
- [ ] 手动测试：用户体验验证

## 技术要点

### 并发控制
- 使用 `transitionLock` 防止状态竞争
- 确保进程操作的原子性
- 避免重复启动进程

### 错误恢复
- 明确的错误状态和恢复路径
- 自动清理资源
- 用户友好的错误提示

### 性能优化
- 减少不必要的状态变更
- 优化事件监听器管理
- 及时清理资源

## 预期收益

1. **彻底解决重复进程问题**
2. **提高系统稳定性和可靠性**
3. **简化错误处理和恢复逻辑**
4. **改善用户体验**
5. **降低维护成本**

## 风险评估

### 技术风险
- 状态机复杂度增加
- 现有代码兼容性
- 测试覆盖度要求

### 缓解措施
- 渐进式重构
- 充分的单元测试
- 保留回滚方案

## 后续优化

1. **添加进程健康检查**
2. **实现录音质量监控**
3. **支持录音暂停/恢复**
4. **添加详细的操作日志**

---

**文档版本**: 1.0  
**创建日期**: 2024年12月  
**状态**: 待实施