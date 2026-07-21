# 管理后台 - 内容安全审核与AI质量监控工作台 详细设计

## 1. 概述

### 1.1 模块定位

本模块是 PrimeTop 管理后台 Web 前端的核心功能工作台之一，面向**内容审核员**、**安全运营人员**和**AI质量质检员**，提供统一的审核工作台界面，用于：

1. AI 对话内容安全审核与违规处置
2. 用户生成内容（UGC）审核（拍题图片、作文上传、用户反馈等）
3. 敏感词库与安全规则配置管理
4. AI 输出质量抽样质检与人工标注
5. 内容违规案例全生命周期管理
6. 审核数据看板与运营分析

### 1.2 设计目标

| 目标 | 说明 |
| --- | --- |
| 统一入口 | 将分散的安全审核、AI质检、UGC审核整合为统一工作台 |
| 高效处置 | 审核员单条内容平均处置时间 < 30 秒 |
| 可追溯 | 所有审核操作留存审计日志，支持复议与追溯 |
| 灵活配置 | 敏感词、规则、审核流、抽样比例可后台动态配置 |
| 数据驱动 | 提供多维度审核统计与趋势分析 |

### 1.3 与已有服务端模块的关系

本工作台是以下服务端模块的**前端消费方**，不重复定义后端逻辑：

| 服务端模块 | 对应工作台功能 |
| --- | --- |
| `服务端-教育内容审核工作流与多级审核管线` | 审核任务队列、多级审核流转 |
| `服务端-AI对话安全审计与敏感内容自动上报服务` | AI对话安全审核列表、自动上报详情 |
| `服务端-教育场景敏感词多层次过滤与内容安全规则引擎` | 敏感词库管理、规则配置 |
| `服务端-大模型流式输出实时安全过滤中间件` | 实时拦截记录查看 |
| `服务端-用户生成内容安全审核` | UGC内容审核队列 |
| `服务端-AI对话质量抽样审核与标注工作台服务` | AI质量质检标注界面 |
| `服务端-AIGC内容标识与生成内容溯源水印系统` | AIGC内容标识查询 |

### 1.4 用户角色

| 角色 | 权限范围 |
| --- | --- |
| 初级审核员 | 查看、处置分配给自己的审核任务 |
| 高级审核员 | 初级权限 + 复议申请审核、批量处置 |
| 安全运营专员 | 初高级权限 + 规则配置、敏感词管理、案例管理 |
| AI质量质检员 | AI输出质量抽检、标注、评分 |
| 管理员 | 全部权限 + 审核员管理、绩效查看、系统配置 |

---

## 2. 数据结构定义

### 2.1 前端核心数据模型

以下为工作台前端使用的 TypeScript 类型定义，与后端 API 响应结构对应。

#### 2.1.1 审核任务 (ReviewTask)

```typescript
/**
 * 审核任务统一模型
 */
interface ReviewTask {
  id: string;                          // 任务ID
  taskNo: string;                      // 任务编号 RVT-20260722-000001
  type: ReviewTaskType;                // 任务类型
  source: ReviewSource;                // 来源
  priority: 'P0' | 'P1' | 'P2' | 'P3'; // 优先级
  status: ReviewTaskStatus;            // 任务状态
  assigneeId?: string;                 // 当前处理人ID
  assigneeName?: string;               // 当前处理人姓名
  
  // 内容主体
  contentSnapshot: ContentSnapshot;     // 内容快照（不直接引用用户数据）
  
  // 风险信息
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  riskLabels: RiskLabel[];              // 风险标签列表
  hitRules: HitRule[];                  // 命中规则列表
  autoDecision?: 'pass' | 'block' | 'review'; // 系统初筛决策
  
  // 用户上下文
  userContext: {
    userId: string;
    userRole: 'student' | 'parent' | 'teacher';
    gradeLevel?: string;                // 学生年级（用于未成年保护判断）
    isMinor: boolean;
    userViolationCount: number;         // 历史违规次数
  };
  
  // AI上下文（仅AI对话质检时填充）
  aiContext?: {
    conversationId: string;
    messageId: string;
    modelName: string;
    promptTemplateId?: string;
    inputContent: string;               // 用户输入
    outputContent: string;              // AI输出
    ragReferences?: string[];           // RAG引用的知识片段
  };
  
  // 审核流转
  reviewHistory: ReviewAction[];        // 审核操作历史
  currentStage: number;                 // 当前审核层级（1=一审, 2=二审...）
  totalStages: number;                  // 总审核层级
  
  // 时间
  createdAt: string;                    // ISO8601
  assignedAt?: string;
  resolvedAt?: string;
  slaDeadline?: string;                 // SLA截止时间
  
  // 元数据
  tags: string[];
  metadata?: Record<string, any>;
}

type ReviewTaskType = 
  | 'ai_safety'              // AI对话安全审核
  | 'ai_quality'             // AI输出质量质检
  | 'ugc_image'              // 用户上传图片审核
  | 'ugc_text'               // 用户生成文本审核
  | 'ugc_composition'        // 用户作文审核
  | 'feedback_report'        // 用户举报反馈
  | 'sensitive_word_hit'     // 敏感词命中确认
  | 'appeal_review';         // 申诉复议

type ReviewSource = 
  | 'auto_flagged'           // 系统自动标记
  | 'user_reported'          // 用户举报
  | 'random_sampled'         // 随机抽检
  | 'strategy_sampled'       // 策略抽检
  | 'manual_created';        // 人工创建

type ReviewTaskStatus = 
  | 'pending'                // 待分配
  | 'assigned'               // 已分配待处理
  | 'in_review'              // 审核中
  | 'pending_second_review'  // 待二审
  | 'resolved_pass'          // 审核通过
  | 'resolved_block'         // 审核拒绝/拦截
  | 'resolved_warning'       // 警告处理
  | 'pending_appeal'         // 待申诉审核
  | 'escalated';             // 升级处理
```

#### 2.1.2 审核操作记录 (ReviewAction)

```typescript
interface ReviewAction {
  id: string;
  taskId: string;
  reviewerId: string;
  reviewerName: string;
  reviewerRole: string;
  
  action: 'approve' | 'reject' | 'warn' | 'escalate' 
        | 'request_second_review' | 'reassign' | 'note';
  
  decision: 'pass' | 'block' | 'warning' | 'need_more_info';
  
  riskLabels: string[];              // 标注的风险标签
  riskLevel?: 'low' | 'medium' | 'high' | 'critical';
  
  comment: string;                   // 审核备注
  rejectReason?: string;             // 拒绝原因代码
  rejectReasonDetail?: string;       // 拒绝详细说明
  
  attachments?: Array<{              // 附件（如截图证据）
    name: string;
    url: string;
    type: 'image' | 'document';
  }>;
  
  stage: number;                     // 审核层级
  duration: number;                  // 处理耗时（秒）
  
  createdAt: string;
}
```

#### 2.1.3 敏感词词条 (SensitiveWordEntry)

```typescript
interface SensitiveWordEntry {
  id: string;
  word: string;                       // 敏感词
  category: SensitiveCategory;        // 分类
  level: 'block' | 'review' | 'warn'; // 处置级别
  matchType: 'exact' | 'fuzzy' | 'regex' | 'pinyin'; // 匹配方式
  
  // 适用范围
  applicableScenes: ApplicableScene[];
  applicableUserRoles: string[];
  
  // 替换/处置策略
  replaceTo?: string;                 // 替换为的内容（如 ***）
  action: 'replace' | 'block' | 'review' | 'mask';
  
  // 状态
  enabled: boolean;
  validFrom?: string;
  validUntil?: string;
  
  // 变更追溯
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
  
  // 统计
  hitCount30d: number;               // 近30天命中次数
  lastHitAt?: string;
}

type SensitiveCategory = 
  | 'political'              // 政治敏感
  | 'violence'               // 暴力恐怖
  | 'pornographic'           // 色情低俗
  | 'gambling'               // 赌博
  | 'fraud'                  // 诈骗
  | 'insult'                 // 辱骂攻击
  | 'privacy'                // 隐私信息
  | 'advertisement'          // 广告引流
  | 'answer_leak'            // 答案泄露
  | 'exam_cheating'          // 考试作弊
  | 'inappropriate_content'  // 不适宜内容
  | 'custom';                // 自定义

type ApplicableScene = 
  | 'ai_input'               // AI对话输入
  | 'ai_output'              // AI对话输出
  | 'ugc_upload'             // UGC上传
  | 'composition'            // 作文内容
  | 'user_profile'           // 用户资料
  | 'feedback'               // 用户反馈
  | 'community';             // 社区互动
```

#### 2.1.4 AI质量标注 (QualityAnnotation)

```typescript
interface QualityAnnotation {
  id: string;
  taskId: string;                     // 关联审核任务ID
  
  // 标注维度
  accuracy: number;                    // 准确性评分 1-5
  ageAppropriateness: number;          // 适龄性评分 1-5
  helpfulness: number;                 // 有用性评分 1-5
  safety: number;                      // 安全性评分 1-5
  formatting: number;                  // 排版格式评分 1-5
  
  // 问题标注
  issues: QualityIssue[];              // 发现的问题列表
  
  // 知识点校验
  knowledgePoints: Array<{
    point: string;
    correct: boolean;
    note?: string;
  }>;
  
  // 总体评价
  overallScore: number;                // 综合评分 1-100
  verdict: 'excellent' | 'good' | 'acceptable' | 'poor' | 'harmful';
  comment: string;
  
  // 改进建议
  suggestedPromptImprovement?: string;  // Prompt改进建议
  shouldBeRefined: boolean;             // 是否需要回流训练
  
  annotatorId: string;
  annotatedAt: string;
  duration: number;                     // 标注耗时（秒）
}

interface QualityIssue {
  type: 'factual_error'           // 事实性错误
      | 'calculation_error'       // 计算错误
      | 'logic_error'             // 逻辑错误
      | 'inappropriate_language'  // 不当语言
      | 'missing_steps'           // 步骤缺失
      | 'incorrect_knowledge'     // 知识点错误
      | 'poor_structure'          // 结构混乱
      | 'safety_violation'        // 安全违规
      | 'age_mismatch';           // 适龄性不符
  severity: 'critical' | 'major' | 'minor' | 'suggestion';
  description: string;
  position?: string;              // 在回答中的位置引用
  correction?: string;            // 正确内容
}
```

#### 2.1.5 审核规则配置 (ReviewRule)

```typescript
interface ReviewRule {
  id: string;
  name: string;
  description: string;
  
  // 触发条件
  conditions: RuleCondition[];        // 条件组（AND关系）
  
  // 处置动作
  action: 'auto_pass' | 'auto_block' | 'auto_warn' | 'route_to_review';
  targetQueue?: string;               // 路由到的审核队列
  priorityOverride?: 'P0' | 'P1' | 'P2' | 'P3';
  
  // 适用范围
  enabled: boolean;
  scope: {
    taskTypes?: ReviewTaskType[];
    userRoles?: string[];
    gradeLevels?: string[];
  };
  
  // 优先级
  rulePriority: number;               // 规则优先级（高优先）
  
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
  
  // 效果统计
  stats: {
    triggerCount7d: number;
    triggerCount30d: number;
    accuracyRate: number;              // 自动处置准确率
  };
}

interface RuleCondition {
  field: RuleField;
  operator: 'equals' | 'contains' | 'matches_regex' | 'in_list' 
          | 'greater_than' | 'less_than' | 'between';
  value: string | number | string[];
}

type RuleField = 
  | 'risk_level'
  | 'risk_labels'
  | 'user_violation_count'
  | 'content_type'
  | 'ai_model_name'
  | 'hit_sensitive_category'
  | 'user_grade_level'
  | 'auto_decision';
```

---

## 2.2 前端状态管理

### 2.2.1 工作台全局状态 (ReviewWorkbenchStore)

```typescript
/**
 * Pinia Store - 审核工作台全局状态
 * 文件位置: src/stores/review-workbench.ts
 */
import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';

export const useReviewWorkbenchStore = defineStore('review-workbench', () => {
  // ====== 当前用户信息 ======
  const currentUser = ref<ReviewerProfile | null>(null);
  const currentUserRole = ref<ReviewerRole>('viewer');
  
  // ====== 任务队列 ======
  const myPendingTasks = ref<ReviewTask[]>([]);
  const myPendingCount = ref(0);
  const queueStats = ref<QueueStats | null>(null);
  
  // ====== 当前处理任务 ======
  const currentTask = ref<ReviewTask | null>(null);
  const currentTaskDetail = ref<ReviewTaskDetail | null>(null);
  const isProcessing = ref(false);
  
  // ====== 快捷操作面板状态 ======
  const quickActionBar = ref({
    show: true,
    commonRejectReasons: [] as RejectReason[],
    commonRiskLabels: [] as RiskLabel[],
  });
  
  // ====== 批量操作 ======
  const batchMode = ref(false);
  const selectedTaskIds = ref<Set<string>>(new Set());
  
  // ====== 筛选条件 ======
  const filters = ref<ReviewFilters>({
    taskType: 'all',
    riskLevel: 'all',
    status: 'pending',
    dateRange: 'today',
    keyword: '',
    assignee: 'me',
  });
  
  // ====== 统计面板 ======
  const dashboardData = ref<DashboardData | null>(null);
  const dashboardLoading = ref(false);
  const dashboardDateRange = ref<[Date, Date]>(getDefaultDateRange());
  
  // ====== Computed ======
  const hasUrgentTasks = computed(() => 
    myPendingTasks.value.some(t => 
      t.priority === 'P0' && 
      t.slaDeadline && 
      new Date(t.slaDeadline).getTime() - Date.now() < 30 * 60 * 1000
    )
  );
  
  const totalBatchSelected = computed(() => selectedTaskIds.value.size);
  
  // ====== Actions ======
  async function fetchMyPendingTasks(page = 1, pageSize = 20) {
    const res = await reviewApi.getMyTasks({
      ...filters.value,
      page,
      pageSize,
    });
    myPendingTasks.value = res.items;
    myPendingCount.value = res.total;
  }
  
  async function startReviewTask(taskId: string) {
    isProcessing.value = true;
    const res = await reviewApi.startReview(taskId);
    currentTask.value = res.task;
    currentTaskDetail.value = res.detail;
  }
  
  async function submitReviewDecision(
    taskId: string, 
    decision: ReviewDecision
  ) {
    await reviewApi.submitDecision(taskId, decision);
    // 自动加载下一条
    await loadNextTask();
  }
  
  async function loadNextTask() {
    const next = myPendingTasks.value.find(
      t => t.status === 'assigned' && t.assigneeId === currentUser.value?.id
    );
    if (next) {
      await startReviewTask(next.id);
    } else {
      currentTask.value = null;
      currentTaskDetail.value = null;
      isProcessing.value = false;
      await fetchMyPendingTasks();
    }
  }
  
  return {
    currentUser, currentUserRole,
    myPendingTasks, myPendingCount, queueStats,
    currentTask, currentTaskDetail, isProcessing,
    quickActionBar,
    batchMode, selectedTaskIds,
    filters,
    dashboardData, dashboardLoading, dashboardDateRange,
    hasUrgentTasks, totalBatchSelected,
    fetchMyPendingTasks, startReviewTask, 
    submitReviewDecision, loadNextTask,
  };
});
```

---

## 3. 页面架构与路由设计

### 3.1 路由结构

```
/admin/review                    → 审核工作台首页（任务队列）
/admin/review/queue              → 审核任务队列列表
/admin/review/task/:id           → 单条审核任务详情与处置
/admin/review/batch              → 批量审核模式
/admin/review/dashboard          → 审核数据看板
/admin/review/cases              → 违规案例管理
/admin/review/case/:id           → 案例详情
/admin/review/appeals            → 申诉复议列表
/admin/review/appeal/:id         → 申诉详情处理
/admin/review/quality            → AI质量质检工作台
/admin/review/quality/:id        → AI质量标注详情
/admin/review/sensitive-words    → 敏感词库管理
/admin/review/rules              → 审核规则配置
/admin/review/team               → 审核团队与绩效
/admin/review/logs               → 审核操作日志查询
```

### 3.2 页面架构图

```
┌─────────────────────────────────────────────────────────┐
│                  管理后台顶部导航栏                        │
│  [Logo] [用户管理] [内容管理] [AI管理] [审核中心▼] [数据] │
│                                       └─ 审核工作台      │
│                                          质量质检        │
│                                          敏感词库        │
│                                          审核规则        │
│                                          违规案例        │
│                                          申诉复议        │
│                                          团队管理        │
├─────────────────────────────────────────────────────────┤
│                  左侧二级菜单                              │
│  ┌──────────┐  ┌────────────────────────────────────┐   │
│  │ 工作台   │  │                                    │   │
│  │ 任务队列 │  │         主内容区域                   │   │
│  │ 数据看板 │  │                                    │   │
│  │ 质量质检 │  │                                    │   │
│  │ 敏感词库 │  │                                    │   │
│  │ 审核规则 │  │                                    │   │
│  │ 违规案例 │  │                                    │   │
│  │ 申诉复议 │  │                                    │   │
│  │ 团队管理 │  │                                    │   │
│  │ 操作日志 │  │                                    │   │
│  └──────────┘  └────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────┤
│                  底部状态栏                               │
│  待处理: 23 | 处理中: 1 | SLA告警: 2 | 今日已处理: 45    │
└─────────────────────────────────────────────────────────┘
```

---

## 4. 核心页面详细设计

### 4.1 审核任务队列页 (ReviewQueue)

#### 4.1.1 页面布局

```
┌─────────────────────────────────────────────────────────────┐
│ 审核任务队列                                                 │
├─────────────────────────────────────────────────────────────┤
│ ┌─ 筛选条件区 ──────────────────────────────────────────────┐│
│ │ 任务类型[全部▼] 风险等级[全部▼] 状态[待处理▼]             ││
│ │ 指派[我的▼] 日期[今天▼] 关键词[__________] [搜索]         ││
│ │ ☐ 仅看SLA告警  ☐ 仅看申诉    [批量操作▼]  [导出]         ││
│ └──────────────────────────────────────────────────────────┘│
│                                                              │
│ ┌─ 统计概览 ────────────────────────────────────────────────┐│
│ │  待处理: 23    处理中: 1    今日已完成: 45                 ││
│ │  P0紧急: 2     P1高优: 5    SLA超时: 1                    ││
│ │  平均处置时长: 28s    通过率: 87.3%                       ││
│ └──────────────────────────────────────────────────────────┘│
│                                                              │
│ ┌─ 任务列表（表格）─────────────────────────────────────────┐│
│ │ ☐ │任务编号    │类型    │风险│状态  │指派给 │SLA  │操作   ││
│ │───┼───────────┼────────┼────┼─────┼──────┼─────┼──────  ││
│ │ ☐ │RVT-...001 │AI安全  │ 高 │待处理│ --   │2h   │[开始]  ││
│ │ ☐ │RVT-...002 │UGC图片 │ 中 │待处理│ --   │8h   │[开始]  ││
│ │ ☐ │RVT-...003 │AI质检  │ 低 │处理中│张三  │24h  │[查看]  ││
│ │ ☐ │RVT-...004 │举报反馈│ 高 │待复议│李四  │--   │[详情]  ││
│ │   │  ...       │        │    │      │      │     │        ││
│ └──────────────────────────────────────────────────────────┘│
│                                                              │
│ 分页: < 1 2 3 ... 10 >  每页: [20▼]                         │
└─────────────────────────────────────────────────────────────┘
```

#### 4.1.2 Vue 组件结构

```vue
<!-- src/views/admin/review/ReviewQueue.vue -->
<template>
  <div class="review-queue-page">
    <!-- 筛选条件 -->
    <ReviewFilterBar
      v-model:filters="store.filters"
      @search="handleSearch"
      @reset="handleReset"
    />
    
    <!-- 统计概览卡片 -->
    <ReviewStatsBar :stats="store.queueStats" />
    
    <!-- 批量操作工具栏（批量模式时显示） -->
    <ReviewBatchToolbar
      v-if="store.batchMode"
      :selected-count="store.totalBatchSelected"
      @batch-action="handleBatchAction"
      @exit-batch="exitBatchMode"
    />
    
    <!-- 任务列表表格 -->
    <ReviewTaskTable
      :tasks="store.myPendingTasks"
      :loading="loading"
      :batch-mode="store.batchMode"
      v-model:selected="store.selectedTaskIds"
      @start-review="handleStartReview"
      @view-detail="handleViewDetail"
      @sort-change="handleSortChange"
    />
    
    <!-- 分页 -->
    <Pagination
      v-model:current-page="currentPage"
      v-model:page-size="pageSize"
      :total="store.myPendingCount"
      @change="fetchData"
    />
    
    <!-- SLA告警悬浮提示 -->
    <SlaAlertToast
      :visible="store.hasUrgentTasks"
      :tasks="store.myPendingTasks"
      @click-task="handleStartReview"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useReviewWorkbenchStore } from '@/stores/review-workbench';
import ReviewFilterBar from '@/components/review/ReviewFilterBar.vue';
import ReviewStatsBar from '@/components/review/ReviewStatsBar.vue';
import ReviewTaskTable from '@/components/review/ReviewTaskTable.vue';
import ReviewBatchToolbar from '@/components/review/ReviewBatchToolbar.vue';
import SlaAlertToast from '@/components/review/SlaAlertToast.vue';
import Pagination from '@/components/common/Pagination.vue';

const router = useRouter();
const store = useReviewWorkbenchStore();
const loading = ref(false);
const currentPage = ref(1);
const pageSize = ref(20);

// 轮询间隔
let pollTimer: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  loadData();
  // 每30秒轮询待处理数量
  pollTimer = setInterval(() => {
    store.fetchMyPendingTasks(currentPage.value, pageSize.value);
  }, 30_000);
});

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
});

async function loadData() {
  loading.value = true;
  try {
    await Promise.all([
      store.fetchMyPendingTasks(currentPage.value, pageSize.value),
      store.fetchQueueStats(),
    ]);
  } finally {
    loading.value = false;
  }
}

function handleStartReview(task: ReviewTask) {
  router.push(`/admin/review/task/${task.id}`);
}

function handleBatchAction(action: string) {
  // 批量通过/拒绝/指派
}

function exitBatchMode() {
  store.batchMode = false;
  store.selectedTaskIds.clear();
}
</script>
```

#### 4.1.3 任务表格行组件（关键交互）

```vue
<!-- src/components/review/ReviewTaskRow.vue -->
<template>
  <tr 
    :class="[
      'review-task-row',
      { 'is-critical': task.riskLevel === 'critical',
        'is-sla-warning': isSlaWarning }
    ]"
  >
    <td v-if="batchMode">
      <Checkbox :value="task.id" v-model="selectedSet" />
    </td>
    
    <!-- 任务编号 -->
    <td class="col-task-no">
      <span class="task-no">{{ task.taskNo }}</span>
      <RiskBadge :level="task.riskLevel" />
      <span v-if="task.userContext.isMinor" class="minor-tag">未成年</span>
    </td>
    
    <!-- 类型与来源 -->
    <td class="col-type">
      <TaskTypeTag :type="task.type" />
      <SourceTag :source="task.source" />
    </td>
    
    <!-- 内容预览 -->
    <td class="col-preview">
      <ContentPreview :snapshot="task.contentSnapshot" :max-chars="60" />
    </td>
    
    <!-- 命中规则 -->
    <td class="col-hit-rules">
      <HitRuleBadges :rules="task.hitRules" :max-display="3" />
    </td>
    
    <!-- 指派 -->
    <td class="col-assignee">
      <AssigneeCell 
        :assignee="task.assigneeName"
        :current-user="store.currentUser?.name"
        @assign-to-me="assignToMe"
      />
    </td>
    
    <!-- SLA -->
    <td class="col-sla">
      <SlaTimer 
        :deadline="task.slaDeadline"
        :created-at="task.createdAt"
      />
    </td>
    
    <!-- 操作 -->
    <td class="col-actions">
      <el-button-group>
        <el-button 
          v-if="canStartReview"
          type="primary" 
          size="small"
          @click="$emit('start-review', task)"
        >
          开始审核
        </el-button>
        <el-button
          v-else
          size="small"
          @click="$emit('view-detail', task)"
        >
          详情
        </el-button>
      </el-button-group>
    </td>
  </tr>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useReviewWorkbenchStore } from '@/stores/review-workbench';

const props = defineProps<{
  task: ReviewTask;
  batchMode: boolean;
}>();

const emit = defineEmits<{
  'start-review': [task: ReviewTask];
  'view-detail': [task: ReviewTask];
  'assign': [taskId: string, userId: string];
}>();

const store = useReviewWorkbenchStore();

const canStartReview = computed(() => 
  props.task.status === 'pending' || props.task.status === 'assigned'
);

const isSlaWarning = computed(() => {
  if (!props.task.slaDeadline) return false;
  const remaining = new Date(props.task.slaDeadline).getTime() - Date.now();
  return remaining < 30 * 60 * 1000 && remaining > 0; // 30分钟内
});

async function assignToMe() {
  emit('assign', props.task.id, store.currentUser!.id);
}
</script>
```

---

### 4.2 审核处置详情页 (ReviewTaskDetail)

这是审核员最核心的工作页面，采用**三栏布局**：左侧内容展示 → 中间决策面板 → 右侧上下文信息。

#### 4.2.1 页面布局

```
┌──────────────────────────────────────────────────────────────────────┐
│ ← 返回列表   RVT-20260722-000001  [AI安全审核] [高风险] [未成年]      │
│                                                  SLA: 1h 23m 剩余     │
├──────────────────────┬───────────────────────┬───────────────────────┤
│                      │                       │                       │
│   内容展示区          │   决策操作区            │   上下文信息区          │
│                      │                       │                       │
│ ┌──────────────────┐ │ ┌───────────────────┐ │ ┌───────────────────┐ │
│ │ 用户输入:         │ │ │ 审核决策           │ │ │ 用户信息           │ │
│ │ "什么是光合作用"  │ │ │                   │ │ │ ID: U12345         │ │
│ │ (7年级学生)       │ │ │ ○ 通过            │ │ │ 角色: 学生         │ │
│ ├──────────────────┤ │ │ ○ 拒绝            │ │ │ 年级: 初一         │ │
│ │ AI回答:           │ │ │ ○ 警告            │ │ │ 未成年: 是         │ │
│ │ "光合作用是指..." │ │ │ ○ 需要更多信息     │ │ │ 违规次数: 0        │ │
│ │                  │ │ │                   │ │ ├───────────────────┤ │
│ │ [展开完整对话]    │ │ │ 风险标签:         │ │ │ AI模型信息          │ │
│ │                  │ │ │ ☐ 政治敏感        │ │ │ 模型: glm-4        │ │
│ ├──────────────────┤ │ │ ☐ 暴力            │ │ │ Prompt: BIO_7_03   │ │
│ │ 高亮标记:         │ │ │ ☐ 色情            │ │ │ RAG: 3条引用       │ │
│ │ 🔴 "xxx不适宜"   │ │ │ ☑ 答案泄露        │ │ ├───────────────────┤ │
│ │ 🟡 "建议修改..." │ │ │ ☐ 不当引导        │ │ │ 命中规则           │ │
│ │                  │ │ │                   │ │ │ · 答案管控规则#12  │ │
│ ├──────────────────┤ │ │ 拒绝原因:         │ │ │ · 适龄性检查#3     │ │
│ │ RAG引用知识:     │ │ │ [请选择▼]         │ │ ├───────────────────┤ │
│ │ 1. 生物七上P45   │ │ │ 详细说明:         │ │ │ 审核历史           │ │
│ │ 2. 知识点: 光合  │ │ │ [____________]    │ │ │ (暂无历史)         │ │
│ │ ─────────────   │ │ │                   │ │ ├───────────────────┤ │
│ │ 3. 相关考点: ... │ │ │ ☐ 添加到案例库    │ │ │ 相似案例           │ │
│ │                  │ │ │                   │ │ │ · 案例#234(85%相似)│ │
│ │                  │ │ │ [提交决策]         │ │ │ · 案例#189(72%相似)│ │
│ │                  │ │ │ [跳过] [转交]     │ │ │                   │ │
│ │                  │ │ │                   │ │ │                   │ │
│ └──────────────────┘ │ └───────────────────┘ │ └───────────────────┘ │
│                      │                       │                       │
├──────────────────────┴───────────────────────┴───────────────────────┤
│  快捷键: [Enter]提交  [Space]通过  [B]拒绝  [N]下一条  [P]标记重点   │
│  处理计时: 00:15  |  预估剩余: 22 条                                │
└──────────────────────────────────────────────────────────────────────┘
```

#### 4.2.2 Vue 组件实现

```vue
<!-- src/views/admin/review/ReviewTaskDetail.vue -->
<template>
  <div class="review-detail-page" v-loading="loading">
    <!-- 顶部信息栏 -->
    <ReviewDetailHeader
      :task="store.currentTask"
      :sla-remaining="slaRemaining"
      @back="goBack"
    />
    
    <!-- 三栏布局 -->
    <div class="review-detail-body">
      <!-- 左栏：内容展示 -->
      <div class="content-pane">
        <ContentDisplayPanel
          :task="store.currentTask"
          :detail="store.currentTaskDetail"
          :highlights="contentHighlights"
          @view-full-conversation="openConversationModal"
          @add-highlight="addHighlight"
        />
      </div>
      
      <!-- 中栏：决策操作 -->
      <div class="decision-pane">
        <DecisionPanel
          :task="store.currentTask"
          :common-reject-reasons="store.quickActionBar.commonRejectReasons"
          :common-risk-labels="store.quickActionBar.commonRiskLabels"
          @submit="handleSubmitDecision"
          @skip="handleSkip"
          @transfer="handleTransfer"
        />
      </div>
      
      <!-- 右栏：上下文信息 -->
      <div class="context-pane">
        <ContextInfoPanel
          :task="store.currentTask"
          :similar-cases="similarCases"
          @view-case="viewCase"
        />
      </div>
    </div>
    
    <!-- 底部状态栏 -->
    <ReviewStatusBar
      :processing-time="processingTime"
      :remaining-count="remainingCount"
      :current-shortcuts="shortcutHints"
    />
    
    <!-- 全屏对话查看弹窗 -->
    <ConversationViewerModal
      v-if="conversationModalVisible"
      :conversation-id="store.currentTask?.aiContext?.conversationId"
      @close="conversationModalVisible = false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useReviewWorkbenchStore } from '@/stores/review-workbench';
import { useKeyboardShortcuts } from '@/composables/useKeyboardShortcuts';
import ReviewDetailHeader from '@/components/review/detail/ReviewDetailHeader.vue';
import ContentDisplayPanel from '@/components/review/detail/ContentDisplayPanel.vue';
import DecisionPanel from '@/components/review/detail/DecisionPanel.vue';
import ContextInfoPanel from '@/components/review/detail/ContextInfoPanel.vue';
import ReviewStatusBar from '@/components/review/detail/ReviewStatusBar.vue';
import ConversationViewerModal from '@/components/review/detail/ConversationViewerModal.vue';

const route = useRoute();
const router = useRouter();
const store = useReviewWorkbenchStore();

const loading = ref(false);
const processingTime = ref(0);
const slaRemaining = ref('');
const conversationModalVisible = ref(false);
const contentHighlights = ref<Highlight[]>([]);
const similarCases = ref<SimilarCase[]>([]);
const processingTimer = ref<ReturnType<typeof setInterval> | null>(null);
const slaTimer = ref<ReturnType<typeof setInterval> | null>(null);

const remainingCount = computed(() => store.myPendingCount);
const taskId = computed(() => route.params.id as string);

// 快捷键绑定
useKeyboardShortcuts({
  'Enter': () => handleSubmitDecision({ action: 'submit' }),
  ' ': (e) => { e.preventDefault(); handleSubmitDecision({ decision: 'pass' }); }, // Space
  'b': () => handleSubmitDecision({ decision: 'block' }),
  'n': () => handleSkip(),
  'p': () => addQuickHighlight(),
  'Escape': () => goBack(),
});

onMounted(async () => {
  loading.value = true;
  try {
    await store.startReviewTask(taskId.value);
    startProcessingTimer();
    startSlaTimer();
    await fetchSimilarCases(taskId.value);
  } finally {
    loading.value = false;
  }
});

onUnmounted(() => {
  stopProcessingTimer();
  stopSlaTimer();
});

function startProcessingTimer() {
  const startTime = Date.now();
  processingTimer.value = setInterval(() => {
    processingTime.value = Math.floor((Date.now() - startTime) / 1000);
  }, 1000);
}

function startSlaTimer() {
  updateSlaRemaining();
  slaTimer.value = setInterval(updateSlaRemaining, 30_000);
}

function updateSlaRemaining() {
  if (!store.currentTask?.slaDeadline) {
    slaRemaining.value = '--';
    return;
  }
  const diff = new Date(store.currentTask.slaDeadline).getTime() - Date.now();
  if (diff <= 0) {
    slaRemaining.value = '已超时';
    return;
  }
  const hours = Math.floor(diff / 3_600_000);
  const minutes = Math.floor((diff % 3_600_000) / 60_000);
  slaRemaining.value = `${hours}h ${minutes}m`;
}

async function handleSubmitDecision(decision: Partial<ReviewDecision>) {
  if (!store.currentTask) return;
  
  // 如果是拒绝，校验必填项
  if (decision.decision === 'block' && !decision.rejectReason) {
    ElMessage.warning('请选择拒绝原因');
    return;
  }
  
  await store.submitReviewDecision(store.currentTask.id, decision);
  
  // 自动加载下一条
  ElMessage.success('审核决策已提交');
  await store.loadNextTask();
  
  if (store.currentTask) {
    // 更新URL到新任务
    router.replace(`/admin/review/task/${store.currentTask.id}`);
    contentHighlights.value = [];
  } else {
    router.push('/admin/review/queue');
  }
}

function handleSkip() {
  // 跳过当前任务，放回队列
  store.loadNextTask();
}

async function handleTransfer(transferInfo: { userId: string; reason: string }) {
  if (!store.currentTask) return;
  await reviewApi.transferTask(store.currentTask.id, transferInfo);
  ElMessage.success('任务已转交');
  await store.loadNextTask();
}

function addHighlight(highlight: Highlight) {
  contentHighlights.value.push(highlight);
}

function addQuickHighlight() {
  // 按 P 快捷键时，对选中文本添加标记
  const selection = window.getSelection()?.toString();
  if (selection) {
    contentHighlights.value.push({
      text: selection,
      level: 'warning',
      note: '',
    });
  }
}

async function fetchSimilarCases(taskId: string) {
  similarCases.value = await reviewApi.getSimilarCases(taskId);
}

function openConversationModal() {
  conversationModalVisible.value = true;
}

function viewCase(caseId: string) {
  router.push(`/admin/review/case/${caseId}`);
}

function goBack() {
  router.push('/admin/review/queue');
}

function stopProcessingTimer() {
  if (processingTimer.value) clearInterval(processingTimer.value);
}

function stopSlaTimer() {
  if (slaTimer.value) clearInterval(slaTimer.value);
}
</script>

<style scoped>
.review-detail-page {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 60px); /* 减去顶部导航 */
}

.review-detail-body {
  display: grid;
  grid-template-columns: 1fr 380px 320px;
  gap: 16px;
  flex: 1;
  overflow: hidden;
  padding: 16px;
}

.content-pane {
  overflow-y: auto;
}

.decision-pane {
  overflow-y: auto;
}

.context-pane {
  overflow-y: auto;
}
</style>
```

---

### 4.3 决策面板组件 (DecisionPanel)

```vue
<!-- src/components/review/detail/DecisionPanel.vue -->
<template>
  <div class="decision-panel">
    <h3 class="panel-title">审核决策</h3>
    
    <!-- 决策选项 -->
    <el-radio-group 
      v-model="form.decision" 
      class="decision-options"
      @change="onDecisionChange"
    >
      <el-radio value="pass" class="decision-pass">
        <el-icon><CircleCheck /></el-icon>
        通过
      </el-radio>
      <el-radio value="block" class="decision-block">
        <el-icon><CircleClose /></el-icon>
        拒绝拦截
      </el-radio>
      <el-radio value="warning" class="decision-warn">
        <el-icon><Warning /></el-icon>
        警告处理
      </el-radio>
      <el-radio value="need_more_info">
        <el-icon><QuestionFilled /></el-icon>
        需要更多信息
      </el-radio>
    </el-radio-group>
    
    <!-- 风险标签选择 -->
    <div class="form-section">
      <label class="section-label">
        风险标签
        <span class="required" v-if="form.decision !== 'pass'">*</span>
      </label>
      <el-checkbox-group v-model="form.riskLabels" class="risk-label-grid">
        <el-checkbox 
          v-for="label in availableRiskLabels" 
          :key="label.value"
          :value="label.value"
        >
          {{ label.label }}
        </el-checkbox>
      </el-checkbox-group>
    </div>
    
    <!-- 拒绝原因（拒绝时显示） -->
    <div v-if="form.decision === 'block'" class="form-section">
      <label class="section-label">拒绝原因 <span class="required">*</span></label>
      <el-select 
        v-model="form.rejectReason" 
        placeholder="请选择拒绝原因"
        class="full-width"
      >
        <el-option-group 
          v-for="group in groupedRejectReasons" 
          :key="group.label"
          :label="group.label"
        >
          <el-option 
            v-for="reason in group.options" 
            :key="reason.value"
            :value="reason.value"
            :label="reason.label"
          />
        </el-option-group>
      </el-select>
    </div>
    
    <!-- 详细说明 -->
    <div v-if="form.decision !== 'pass'" class="form-section">
      <label class="section-label">详细说明</label>
      <el-input
        v-model="form.comment"
        type="textarea"
        :rows="3"
        placeholder="请输入审核说明（可选）"
        maxlength="500"
        show-word-limit
      />
    </div>
    
    <!-- 附加选项 -->
    <div class="form-section">
      <el-checkbox v-model="form.addToCase">
        添加到违规案例库
      </el-checkbox>
      <el-checkbox v-if="task.type === 'ai_quality'" v-model="form.flagForRetrain">
        标记为需回流训练数据
      </el-checkbox>
      <el-checkbox v-model="form.notifyUser">
        通知用户处理结果
      </el-checkbox>
    </div>
    
    <!-- 操作按钮 -->
    <div class="action-buttons">
      <el-button 
        type="primary"
        size="large"
        :loading="submitting"
        :disabled="!canSubmit"
        @click="handleSubmit"
      >
        提交决策
        <span class="shortcut-hint">[Enter]</span>
      </el-button>
      <el-button size="large" @click="$emit('skip')">
        跳过 [N]
      </el-button>
      <el-button size="large" @click="transferDialogVisible = true">
        转交...
      </el-button>
    </div>
    
    <!-- 转交弹窗 -->
    <TransferDialog
      v-if="transferDialogVisible"
      :task-id="task.id"
      @close="transferDialogVisible = false"
      @transferred="$emit('transfer', $event)"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch } from 'vue';
import { CircleCheck, CircleClose, Warning, QuestionFilled } from '@element-plus/icons-vue';
import TransferDialog from './TransferDialog.vue';

const props = defineProps<{
  task: ReviewTask;
  commonRejectReasons: RejectReason[];
  commonRiskLabels: RiskLabel[];
}>();

const emit = defineEmits<{
  submit: [decision: ReviewDecision];
  skip: [];
  transfer: [info: { userId: string; reason: string }];
}>();

const submitting = ref(false);
const transferDialogVisible = ref(false);

const form = reactive({
  decision: '' as '' | 'pass' | 'block' | 'warning' | 'need_more_info',
  riskLabels: [] as string[],
  rejectReason: '',
  comment: '',
  addToCase: false,
  flagForRetrain: false,
  notifyUser: false,
});

const availableRiskLabels = computed(() => {
  // 根据任务类型过滤可用标签
  const common = props.commonRiskLabels || [];
  const standardLabels = [
    { value: 'political', label: '政治敏感' },
    { value: 'violence', label: '暴力' },
    { value: 'pornographic', label: '色情低俗' },
    { value: 'answer_leak', label: '答案泄露' },
    { value: 'inappropriate', label: '不适宜内容' },
    { value: 'misleading', label: '误导性内容' },
    { value: 'age_mismatch', label: '适龄性不符' },
    { value: 'factual_error', label: '事实性错误' },
    { value: 'harmful_guidance', label: '有害引导' },
    { value: 'privacy', label: '隐私泄露' },
    { value: 'advertisement', label: '广告引流' },
    { value: 'cheating', label: '考试作弊' },
  ];
  return [...standardLabels, ...common];
});

const groupedRejectReasons = computed(() => [
  {
    label: '内容安全',
    options: props.commonRejectReasons.filter(r => r.category === 'safety'),
  },
  {
    label: '教育合规',
    options: props.commonRejectReasons.filter(r => r.category === 'education'),
  },
  {
    label: 'AI质量',
    options: props.commonRejectReasons.filter(r => r.category === 'quality'),
  },
  {
    label: '其他',
    options: props.commonRejectReasons.filter(r => r.category === 'other'),
  },
]);

const canSubmit = computed(() => {
  if (!form.decision) return false;
  if (form.decision !== 'pass' && form.riskLabels.length === 0) return false;
  if (form.decision === 'block' && !form.rejectReason) return false;
  return true;
});

function onDecisionChange(val: string) {
  // 通过时清空风险标签
  if (val === 'pass') {
    form.riskLabels = [];
    form.rejectReason = '';
  }
}

function handleSubmit() {
  if (!canSubmit.value) return;
  submitting.value = true;
  emit('submit', { ...form });
}

// 暴露给父组件
defineExpose({
  reset: () => {
    form.decision = '';
    form.riskLabels = [];
    form.rejectReason = '';
    form.comment = '';
    form.addToCase = false;
    form.flagForRetrain = false;
    form.notifyUser = false;
  },
});
</script>
```

---

### 4.4 AI质量质检工作台 (QualityReview)

#### 4.4.1 页面布局

```
┌──────────────────────────────────────────────────────────────────────┐
│ AI质量质检工作台                                                      │
├──────────────────────┬───────────────────────┬───────────────────────┤
│                      │                       │                       │
│   AI对话内容          │   质量标注面板          │   参考与对比           │
│                      │                       │                       │
│ ┌──────────────────┐ │ ┌───────────────────┐ │ ┌───────────────────┐ │
│ │ 学生问题:         │ │ │ 维度评分           │ │ │ RAG引用原文        │ │
│ │ "请解释勾股定理"  │ │ │                   │ │ │ ┌───────────────┐ │ │
│ │ (8年级数学)       │ │ │ 准确性: ●●●●○ 4/5 │ │ │ │教材: 数学八上  │ │ │
│ ├──────────────────┤ │ │ 适龄性: ●●●●● 5/5 │ │ │ │章节: 勾股定理  │ │ │
│ │ AI回答:           │ │ │ 有用性: ●●●●○ 4/5 │ │ │ │知识点: ...    │ │ │
│ │ "勾股定理描述了  │ │ │ 安全性: ●●●●● 5/5 │ │ │ └───────────────┘ │ │
│ │  直角三角形三边   │ │ │ 排版:   ●●●○○ 3/5 │ │ │                   │ │
│ │  的关系..."      │ │ │                   │ │ │ 同类问题历史回答   │ │
│ │                  │ │ │ 综合评分: 84/100  │ │ │ ┌───────────────┐ │ │
│ │ [展开推理过程]    │ │ │ 评价: 良好        │ │ │ │ 回答#4523     │ │ │
│ │                  │ │ │                   │ │ │ │ 评分: 91      │ │ │
│ ├──────────────────┤ │ │ 问题标注           │ │ │ └───────────────┘ │ │
│ │ 标记的问题:       │ │ │ + 添加问题        │ │ │                   │ │
│ │ ⚠ 排版: 公式未    │ │ │                   │ │ │ 知识点校验        │ │
│ │   居中显示        │ │ │ ☑ 勾股定理 正确   │ │ │ ┌───────────────┐ │ │
│ │                  │ │ │ ☑ 直角三角形 正确 │ │ │ │ 标准: a²+b²=c²│ │ │
│ │                  │ │ │                   │ │ │ └───────────────┘ │ │
│ │                  │ │ │ [提交标注]         │ │ │                   │ │
│ └──────────────────┘ │ └───────────────────┘ │ └───────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

#### 4.4.2 质量评分维度说明

| 维度 | 评分标准（5分制） | 关键校验点 |
| --- | --- | --- |
| **准确性** | 5=完全正确, 4=微小瑕疵, 3=基本正确有误导, 2=有明显错误, 1=完全错误 | 事实性、计算结果、公式推导 |
| **适龄性** | 5=完全匹配年级, 4=基本匹配, 3=偏深/偏浅, 2=明显不符, 1=严重不符 | 词汇难度、概念深度、示例选择 |
| **有用性** | 5=极具启发, 4=有帮助, 3=一般, 2=帮助有限, 1=无用 | 是否解答了问题、是否有拓展 |
| **安全性** | 5=完全安全, 4=基本安全, 3=边界内容, 2=有风险, 1=违规 | 是否涉及敏感、答案管控 |
| **排版** | 5=专业级, 4=良好, 3=基本可读, 2=混乱, 1=无法阅读 | 公式渲染、分段、格式 |

---

## 5. API 接口设计

### 5.1 审核任务接口

#### 5.1.1 获取审核任务列表

```
GET /admin/api/v1/review/tasks
```

**Query Parameters:**

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| page | int | 否 | 页码，默认 1 |
| page_size | int | 否 | 每页条数，默认 20 |
| type | string | 否 | 任务类型，逗号分隔 |
| risk_level | string | 否 | 风险等级，逗号分隔 |
| status | string | 否 | 任务状态 |
| assignee | string | 否 | `me` / `unassigned` / 用户ID / `all` |
| date_from | string | 否 | 开始日期 YYYY-MM-DD |
| date_to | string | 否 | 结束日期 YYYY-MM-DD |
| keyword | string | 否 | 关键词搜索 |
| sla_warning | boolean | 否 | 仅查看SLA告警 |
| sort | string | 否 | 排序字段: `created_at` / `priority` / `sla_deadline` |

**Response:**

```json
{
  "code": 0,
  "data": {
    "items": [
      {
        "id": "rvt_abc123",
        "task_no": "RVT-20260722-000001",
        "type": "ai_safety",
        "source": "auto_flagged",
        "priority": "P1",
        "status": "pending",
        "risk_level": "high",
        "content_snapshot": {
          "content_type": "text",
          "preview": "什么是光合作用...",
          "full_content_ref": "ref://content/abc123"
        },
        "user_context": {
          "user_id": "U12345",
          "user_role": "student",
          "grade_level": "初一",
          "is_minor": true,
          "user_violation_count": 0
        },
        "hit_rules": [
          {
            "rule_id": "R012",
            "rule_name": "答案管控-直接给出完整答案",
            "confidence": 0.87
          }
        ],
        "auto_decision": "review",
        "sla_deadline": "2026-07-22T18:00:00+08:00",
        "created_at": "2026-07-22T14:30:00+08:00"
      }
    ],
    "total": 23,
    "page": 1,
    "page_size": 20
  }
}
```

#### 5.1.2 获取任务详情

```
GET /admin/api/v1/review/tasks/{taskId}
```

**Response:**

```json
{
  "code": 0,
  "data": {
    "task": { /* ReviewTask */ },
    "detail": {
      "content_snapshot": {
        "user_input": "什么是光合作用",
        "ai_output": "光合作用是指绿色植物...",
        "ai_output_html": "<p>光合作用是指...</p>",
        "conversation_messages": [
          { "role": "user", "content": "什么是光合作用", "timestamp": "..." },
          { "role": "assistant", "content": "...", "timestamp": "..." }
        ]
      },
      "rag_references": [
        {
          "source": "教材",
          "title": "生物 七年级上册",
          "chapter": "第三章 细胞",
          "section": "光合作用",
          "content_snippet": "..."
        }
      ],
      "ai_context": {
        "conversation_id": "conv_xyz",
        "message_id": "msg_abc",
        "model_name": "glm-4",
        "prompt_template_id": "BIO_7_03",
        "prompt_template_name": "初中生物-知识点讲解",
        "token_usage": { "input": 156, "output": 423 }
      },
      "review_history": [],
      "similar_cases": [
        {
          "case_id": "CASE-234",
          "similarity": 0.85,
          "title": "AI直接给出完整答案-光合作用相关",
          "resolved_action": "warning"
        }
      ]
    }
  }
}
```

#### 5.1.3 开始审核

```
POST /admin/api/v1/review/tasks/{taskId}/start
```

将任务状态从 `pending`/`assigned` 变为 `in_review`，记录开始时间。

#### 5.1.4 提交审核决策

```
POST /admin/api/v1/review/tasks/{taskId}/decision
```

**Request Body:**

```json
{
  "decision": "block",
  "risk_labels": ["answer_leak", "age_mismatch"],
  "reject_reason": "R_ANSWER_LEAK_01",
  "comment": "AI直接给出了完整答案，违反答案管控策略，应使用分步提示",
  "add_to_case": true,
  "flag_for_retrain": true,
  "notify_user": false
}
```

**Response:**

```json
{
  "code": 0,
  "data": {
    "task_id": "rvt_abc123",
    "new_status": "resolved_block",
    "next_task_id": "rvt_def456"
  }
}
```

#### 5.1.5 转交任务

```
POST /admin/api/v1/review/tasks/{taskId}/transfer
```

```json
{
  "target_user_id": "admin_002",
  "reason": "需要高级审核员确认是否涉及敏感考点"
}
```

#### 5.1.6 批量操作

```
POST /admin/api/v1/review/tasks/batch
```

```json
{
  "task_ids": ["rvt_001", "rvt_002", "rvt_003"],
  "action": "approve",           // approve | reject | assign | escalate
  "assignee_id": "admin_003",    // action=assign 时必填
  "comment": "批量审核通过",
  "risk_labels": []              // action=reject 时可选
}
```

---

### 5.2 敏感词库管理接口

#### 5.2.1 敏感词列表（分页）

```
GET /admin/api/v1/review/sensitive-words
```

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| page | int | 页码 |
| page_size | int | 每页条数 |
| keyword | string | 搜索词 |
| category | string | 分类筛选 |
| level | string | 级别筛选 |
| enabled | boolean | 启用状态 |
| match_type | string | 匹配方式 |

#### 5.2.2 新增/编辑敏感词

```
POST /admin/api/v1/review/sensitive-words
PUT /admin/api/v1/review/sensitive-words/{id}
```

```json
{
  "word": "某敏感词",
  "category": "political",
  "level": "block",
  "match_type": "fuzzy",
  "applicable_scenes": ["ai_input", "ai_output", "ugc_upload"],
  "applicable_user_roles": ["student", "parent"],
  "action": "replace",
  "replace_to": "***",
  "enabled": true
}
```

#### 5.2.3 批量导入敏感词

```
POST /admin/api/v1/review/sensitive-words/batch-import
Content-Type: multipart/form-data
```

支持 CSV / Excel 文件批量导入，字段格式：

```
word,category,level,match_type,action,replace_to,enabled
某敏感词1,political,block,exact,replace,***,true
某敏感词2,advertisement,review,fuzzy,review,,true
```

#### 5.2.4 敏感词命中统计

```
GET /admin/api/v1/review/sensitive-words/{id}/stats
```

```json
{
  "code": 0,
  "data": {
    "hit_count_7d": 12,
    "hit_count_30d": 45,
    "hit_trend": [
      { "date": "2026-07-16", "count": 3 },
      { "date": "2026-07-17", "count": 5 },
      { "date": "2026-07-18", "count": 2 }
    ],
    "top_scenes": [
      { "scene": "ai_input", "count": 30 },
      { "scene": "ugc_upload", "count": 15 }
    ]
  }
}
```

---

### 5.3 审核规则管理接口

#### 5.3.1 规则列表

```
GET /admin/api/v1/review/rules
```

#### 5.3.2 创建/编辑规则

```
POST /admin/api/v1/review/rules
PUT /admin/api/v1/review/rules/{id}
```

```json
{
  "name": "AI输出答案泄露检测",
  "description": "检测AI回答是否直接给出了完整答案而非分步引导",
  "conditions": [
    {
      "field": "risk_labels",
      "operator": "contains",
      "value": "answer_leak"
    },
    {
      "field": "ai_model_name",
      "operator": "in_list",
      "value": ["glm-4", "gpt-4"]
    }
  ],
  "action": "route_to_review",
  "target_queue": "ai_safety_high",
  "priority_override": "P1",
  "scope": {
    "task_types": ["ai_safety"],
    "user_roles": ["student"],
    "grade_levels": ["all"]
  },
  "rule_priority": 100,
  "enabled": true
}
```

---

### 5.4 审核数据看板接口

#### 5.4.1 看板概览

```
GET /admin/api/v1/review/dashboard/overview
```

**Query:**

| 参数 | 说明 |
| --- | --- |
| date_from | 开始日期 |
| date_to | 结束日期 |
| team_id | 团队ID（可选，查看特定团队） |

**Response:**

```json
{
  "code": 0,
  "data": {
    "summary": {
      "total_tasks": 1250,
      "resolved_tasks": 1180,
      "pending_tasks": 70,
      "avg_handle_time_seconds": 28,
      "pass_rate": 0.873,
      "block_rate": 0.095,
      "warning_rate": 0.032,
      "sla_breach_rate": 0.012,
      "reviewer_count": 8
    },
    "trend": [
      {
        "date": "2026-07-16",
        "total": 210,
        "resolved": 200,
        "avg_handle_time": 26,
        "pass_rate": 0.88
      }
    ],
    "task_type_distribution": {
      "ai_safety": 420,
      "ai_quality": 180,
      "ugc_image": 350,
      "ugc_text": 150,
      "feedback_report": 90,
      "other": 60
    },
    "risk_distribution": {
      "critical": 25,
      "high": 180,
      "medium": 520,
      "low": 525
    },
    "top_risk_labels": [
      { "label": "答案泄露", "count": 85 },
      { "label": "适龄性不符", "count": 62 },
      { "label": "事实性错误", "count": 48 }
    ],
    "top_reviewers": [
      {
        "reviewer_id": "adm_001",
        "reviewer_name": "张三",
        "resolved_count": 320,
        "avg_handle_time": 22,
        "accuracy_rate": 0.96
      }
    ]
  }
}
```

---

## 6. 状态流转设计

### 6.1 审核任务状态机

```
                            ┌──────────────┐
                            │   pending    │ ← 系统创建/用户举报
                            └──────┬───────┘
                                   │ 分配
                                   ▼
                            ┌──────────────┐
                            │   assigned   │
                            └──────┬───────┘
                                   │ 开始审核
                                   ▼
                            ┌──────────────┐
              ┌─────────────│  in_review   │─────────────┐
              │              └──────┬───────┘             │
              │                     │ 提交决策             │
              │         ┌───────────┼───────────┐         │
              │         │           │           │         │
              ▼         ▼           ▼           ▼         ▼
       ┌────────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌──────────┐
       │resolved_pass│ │resolved│ │resolved│ │pending_│ │escalated │
       │            │ │ _block │ │_warning│ │ second │ │          │
       └──────┬─────┘ └───┬────┘ └───┬────┘ │ review │ └────┬─────┘
              │           │          │       └───┬────┘      │
              │     用户申诉│     用户申诉│           │             │
              │           ▼          ▼           ▼             │
              │    ┌────────────┐  ┌────────────┐  │             │
              │    │pending_    │  │pending_    │  │             │
              │    │appeal      │  │appeal      │  │             │
              │    └─────┬──────┘  └─────┬──────┘  │             │
              │          │               │         │             │
              │          ▼               ▼         ▼             │
              │    申诉成功/失败流转    申诉处理              管理员介入
              │                                               │
              └───────────────────────────────────────────────┘
                              最终关闭
```

### 6.2 状态转换规则

| 当前状态 | 目标状态 | 触发条件 | 操作人 |
| --- | --- | --- | --- |
| pending | assigned | 自动分配 / 人工领取 | 系统/审核员 |
| assigned | in_review | 审核员点击"开始审核" | 审核员 |
| in_review | resolved_pass | 决策=通过 | 审核员 |
| in_review | resolved_block | 决策=拒绝 | 审核员 |
| in_review | resolved_warning | 决策=警告 | 审核员 |
| in_review | pending_second_review | 需要二审（高风险/有争议） | 审核员 |
| in_review | escalated | 升级到管理员 | 高级审核员 |
| pending_second_review | in_review | 二审审核员接收 | 高级审核员 |
| resolved_block | pending_appeal | 用户提交申诉 | 用户 |
| resolved_warning | pending_appeal | 用户提交申诉 | 用户 |
| pending_appeal | resolved_pass / resolved_block | 申诉审核 | 高级审核员 |
| escalated | in_review | 管理员重新指派 | 管理员 |

### 6.3 SLA 规则

| 优先级 | 风险等级 | SLA时限 | 超时动作 |
| --- | --- | --- | --- |
| P0 | critical | 30分钟 | 自动升级到管理员 + 告警 |
| P1 | high | 2小时 | 通知团队负责人 |
| P2 | medium | 8小时 | 记录超时 |
| P3 | low | 24小时 | 记录超时 |

---

## 7. 敏感词库管理设计

### 7.1 管理界面布局

```
┌──────────────────────────────────────────────────────────────────┐
│ 敏感词库管理                                           [导入]   │
├──────────────────────────────────────────────────────────────────┤
│                                                                    │
│ ┌─ Tab 切换 ──────────────────────────────────────────────────┐  │
│ │ [词库列表] [批量导入历史] [命中统计] [词库版本]              │  │
│ └────────────────────────────────────────────────────────────┘  │
│                                                                    │
│ ┌─ 筛选 ──────────────────────────────────────────────────────┐  │
│ │ 关键词[________] 分类[全部▼] 级别[全部▼] 匹配方式[全部▼]    │  │
│ │ 状态[启用▼]                           [搜索] [重置] [新增]  │  │
│ └────────────────────────────────────────────────────────────┘  │
│                                                                    │
│ ┌─ 列表 ──────────────────────────────────────────────────────┐  │
│ │ ☐ │敏感词      │分类    │级别  │匹配方式 │适用场景 │命中30d││  │
│ │───┼────────────┼────────┼─────┼────────┼────────┼───────││  │
│ │ ☐ │***         │政治    │阻断  │模糊    │全部     │45    ││  │
│ │ ☐ │***         │广告    │审核  │正则    │UGC     │12    ││  │
│ │ ☐ │***         │作弊    │阻断  │拼音    │AI输入   │8     ││  │
│ │                                                              ││  │
│ │  [批量启用] [批量禁用] [批量删除] [导出]                    ││  │
│ └────────────────────────────────────────────────────────────┘  │
│                                                                    │
│ ┌─ 新增/编辑弹窗 ─────────────────────────────────────────────┐  │
│ │ 敏感词: [________________]                                  │  │
│ │ 分类:   [政治▼]      级别: [阻断▼]                          │  │
│ │ 匹配方式: [模糊▼]    处置: [替换为▼]  替换内容: [***]       │  │
│ │ 适用场景: ☑AI输入 ☑AI输出 ☐UGC上传 ☐作文 ☐资料            │  │
│ │ 适用角色: ☑学生 ☑家长 ☐教师                                │  │
│ │ 有效期:  [2026-01-01] 至 [永久]                            │  │
│ │                                                            │  │
│ │ [预览匹配效果]  [保存]  [取消]                              │  │
│ └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

### 7.2 匹配预览组件

```vue
<!-- src/components/review/sensitive-words/MatchPreview.vue -->
<template>
  <div class="match-preview">
    <h4>匹配效果预览</h4>
    
    <el-input
      v-model="testText"
      type="textarea"
      :rows="4"
      placeholder="输入测试文本，查看匹配效果"
    />
    
    <div class="preview-result">
      <div v-if="matches.length === 0" class="no-match">
        ✓ 未检测到敏感词
      </div>
      <div v-else>
        <div v-for="(match, i) in matches" :key="i" class="match-item">
          <span class="match-position">位置 {{ match.start }}-{{ match.end }}:</span>
          <span class="match-word" :class="match.level">
            {{ match.original }}
          </span>
          →
          <span class="match-replaced">{{ match.replaced }}</span>
        </div>
      </div>
    </div>
    
    <div class="preview-meta">
      <span>匹配耗时: {{ matchTime }}ms</span>
      <span>命中数: {{ matches.length }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, debounce } from 'vue';

const props = defineProps<{
  word: string;
  matchType: 'exact' | 'fuzzy' | 'regex' | 'pinyin';
  action: string;
  replaceTo?: string;
}>();

const testText = ref('');
const matches = ref<MatchResult[]>([]);
const matchTime = ref(0);

// 防抖测试
const runMatch = debounce(async () => {
  if (!testText.value || !props.word) {
    matches.value = [];
    return;
  }
  
  const start = performance.now();
  const res = await reviewApi.testSensitiveWord({
    word: props.word,
    match_type: props.matchType,
    action: props.action,
    replace_to: props.replaceTo,
    test_text: testText.value,
  });
  matchTime.value = Math.round(performance.now() - start);
  matches.value = res.matches;
}, 300);

watch([testText, () => props.word, () => props.matchType], runMatch);
</script>
```

---

## 8. 审核数据看板设计

### 8.1 看板布局

```
┌──────────────────────────────────────────────────────────────────────┐
│ 审核数据看板         日期: [2026-07-01] ~ [2026-07-22]  团队: [全部▼] │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌─核心指标卡片 ───────────────────────────────────────────────────┐ │
│  │ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐            │ │
│  │ │ 总任务数  │ │ 完成率   │ │ 平均耗时  │ │ SLA达标率│            │ │
│  │ │ 1,250    │ │ 94.4%   │ │ 28s      │ │ 98.8%   │            │ │
│  │ │ ↑12%环比 │ │ ↑2.1%   │ │ ↓3s      │ │ ↑0.5%   │            │ │
│  │ └──────────┘ └──────────┘ └──────────┘ └──────────┘            │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                       │
│  ┌─趋势图（折线）───────────┐  ┌─任务类型分布（饼图）────────────┐  │
│  │                          │  │                                │  │
│  │    每日任务量 & 完成量    │  │      AI安全  34%              │  │
│  │    ─── 总量  ─── 完成    │  │      UGC图片  28%             │  │
│  │                          │  │      AI质检   14%             │  │
│  │                          │  │      UGC文本  12%             │  │
│  │                          │  │      举报     7%              │  │
│  └─────────────────────────┘  └────────────────────────────────┘  │
│                                                                       │
│  ┌─审核员绩效排行 ─────────┐  ┌─高频风险标签 TOP10 ────────────┐  │
│  │ 姓名  完成  平均  准确率 │  │                                │  │
│  │ 张三  320  22s  96%     │  │  答案泄露  ████████ 85         │  │
│  │ 李四  285  25s  94%     │  │  适龄不符  ██████   62         │  │
│  │ 王五  210  31s  91%     │  │  事实错误  █████    48         │  │
│  │ 赵六  180  28s  95%     │  │  不当引导  ████     35         │  │
│  │ ...                     │  │  ...                           │  │
│  └─────────────────────────┘  └────────────────────────────────┘  │
│                                                                       │
│  ┌─SLA超时分析 ────────────┐  ┌─申诉复议统计 ──────────────────┐  │
│  │ 超时任务: 15 (1.2%)     │  │ 申诉总量: 23                   │  │
│  │ P0超时: 2   P1超时: 5   │  │ 申诉成功率: 34.8%              │  │
│  │ 主要原因:                │  │ 常见申诉理由:                  │  │
│  │  审核员不足 40%          │  │  误判申诉  65%                 │  │
│  │  任务突增   35%          │  │  处罚过重  20%                 │  │
│  └─────────────────────────┘  └────────────────────────────────┘  │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

### 8.2 ECharts 配置示例

```typescript
// src/composables/useReviewDashboard.ts
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { LineChart, PieChart, BarChart } from 'echarts/charts';
import {
  TitleComponent, TooltipComponent, LegendComponent,
  GridComponent, DataZoomComponent,
} from 'echarts/components';
import { ref, onMounted } from 'vue';

use([
  CanvasRenderer, LineChart, PieChart, BarChart,
  TitleComponent, TooltipComponent, LegendComponent,
  GridComponent, DataZoomComponent,
]);

export function useReviewDashboard(dateRange: Ref<[Date, Date]>) {
  const trendOption = ref<EChartsOption>({});
  const typeDistributionOption = ref<EChartsOption>({});
  const topRiskLabelsOption = ref<EChartsOption>({});
  const reviewerPerformanceOption = ref<EChartsOption>({});
  const loading = ref(false);

  async function loadData() {
    loading.value = true;
    try {
      const data = await reviewApi.getDashboardData({
        date_from: formatDate(dateRange.value[0]),
        date_to: formatDate(dateRange.value[1]),
      });

      // 趋势图配置
      trendOption.value = {
        tooltip: { trigger: 'axis' },
        legend: { data: ['总任务', '已完成', 'SLA超时'] },
        xAxis: {
          type: 'category',
          data: data.trend.map(d => d.date),
        },
        yAxis: [
          { type: 'value', name: '任务数' },
          { type: 'value', name: '超时数', position: 'right' },
        ],
        series: [
          {
            name: '总任务',
            type: 'line',
            smooth: true,
            data: data.trend.map(d => d.total),
            itemStyle: { color: '#409EFF' },
          },
          {
            name: '已完成',
            type: 'line',
            smooth: true,
            data: data.trend.map(d => d.resolved),
            itemStyle: { color: '#67C23A' },
          },
          {
            name: 'SLA超时',
            type: 'line',
            yAxisIndex: 1,
            data: data.trend.map(d => d.sla_breach),
            itemStyle: { color: '#F56C6C' },
          },
        ],
      };

      // 任务类型分布饼图
      typeDistributionOption.value = {
        tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
        legend: { orient: 'vertical', left: 'left' },
        series: [{
          type: 'pie',
          radius: ['40%', '70%'],
          avoidLabelOverlap: false,
          label: { show: true, formatter: '{b}\n{d}%' },
          data: Object.entries(data.task_type_distribution).map(
            ([name, value]) => ({ name: taskTypeLabels[name], value })
          ),
        }],
      };

      // 高危风险标签柱状图
      topRiskLabelsOption.value = {
        tooltip: { trigger: 'axis' },
        xAxis: { 
          type: 'value',
          name: '出现次数',
        },
        yAxis: {
          type: 'category',
          data: data.top_risk_labels.map(l => l.label),
          inverse: true,
        },
        series: [{
          type: 'bar',
          data: data.top_risk_labels.map(l => l.count),
          itemStyle: {
            color: (params: any) => {
              const colors = ['#F56C6C', '#E6A23C', '#409EFF'];
              return colors[params.dataIndex % colors.length];
            },
          },
        }],
      };

      // 审核员绩效
      reviewerPerformanceOption.value = {
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
        legend: { data: ['完成数', '准确率(%)'] },
        xAxis: {
          type: 'category',
          data: data.top_reviewers.map(r => r.reviewer_name),
        },
        yAxis: [
          { type: 'value', name: '完成数' },
          { type: 'value', name: '准确率(%)', max: 100 },
        ],
        series: [
          {
            name: '完成数',
            type: 'bar',
            data: data.top_reviewers.map(r => r.resolved_count),
            itemStyle: { color: '#409EFF' },
          },
          {
            name: '准确率(%)',
            type: 'line',
            yAxisIndex: 1,
            data: data.top_reviewers.map(r => Math.round(r.accuracy_rate * 100)),
            itemStyle: { color: '#67C23A' },
          },
        ],
      };
    } finally {
      loading.value = false;
    }
  }

  onMounted(loadData);

  return {
    trendOption,
    typeDistributionOption,
    topRiskLabelsOption,
    reviewerPerformanceOption,
    loading,
    refresh: loadData,
  };
}
```

---

## 9. 快捷键系统设计

审核员高频操作依赖键盘快捷键，以下是完整快捷键映射：

### 9.1 全局快捷键

| 快捷键 | 功能 | 适用页面 |
| --- | --- | --- |
| `?` | 显示快捷键帮助弹窗 | 全部 |
| `Esc` | 返回上一页 / 关闭弹窗 | 全部 |
| `/` | 聚焦搜索框 | 列表页 |

### 9.2 审核详情页快捷键

| 快捷键 | 功能 |
| --- | --- |
| `Space` | 快速通过 |
| `B` | 快速拒绝 |
| `W` | 警告处理 |
| `Enter` | 提交当前决策 |
| `N` / `→` | 跳过，加载下一条 |
| `P` / `←` | 上一条 |
| `T` | 转交任务 |
| `L` | 添加风险标签 |
| `C` | 聚焦备注输入框 |
| `F` | 标记/取消标记重点 |
| `M` | 放大/缩小内容区域 |
| `R` | 查看RAG引用原文 |
| `H` | 切换高亮模式 |

### 9.3 快捷键管理器

```typescript
// src/composables/useKeyboardShortcuts.ts
import { onMounted, onUnmounted } from 'vue';

type ShortcutHandler = (event: KeyboardEvent) => void;
type ShortcutMap = Record<string, ShortcutHandler>;

export function useKeyboardShortcuts(shortcuts: ShortcutMap) {
  function handleKeyDown(event: KeyboardEvent) {
    // 忽略输入框中的按键（除 Enter 和 Escape）
    const target = event.target as HTMLElement;
    const isInputField = ['INPUT', 'TEXTAREA', 'SELECT'].includes(
      target?.tagName || ''
    );
    
    if (isInputField && event.key !== 'Enter' && event.key !== 'Escape') {
      return;
    }

    // 构建快捷键标识
    const parts: string[] = [];
    if (event.ctrlKey) parts.push('Ctrl');
    if (event.altKey) parts.push('Alt');
    if (event.shiftKey) parts.push('Shift');
    
    // Space 特殊处理
    const key = event.key === ' ' ? ' ' : event.key.toLowerCase();
    parts.push(key);
    
    const shortcutKey = parts.join('+');
    const handler = shortcuts[shortcutKey] || shortcuts[key];
    
    if (handler) {
      event.preventDefault();
      handler(event);
    }
  }

  onMounted(() => {
    document.addEventListener('keydown', handleKeyDown);
  });

  onUnmounted(() => {
    document.removeEventListener('keydown', handleKeyDown);
  });
}
```

---

## 10. 错误处理与降级策略

### 10.1 前端错误处理

```typescript
// src/utils/review-error-handler.ts
import { ElMessage, ElNotification } from 'element-plus';

/**
 * 审核工作台统一错误处理
 */
export class ReviewErrorHandler {
  /**
   * 处理API错误
   */
  static handleApiError(error: any, context: string) {
    const errorCode = error?.response?.data?.code;
    const errorMsg = error?.response?.data?.message || error.message;

    switch (errorCode) {
      case 'REVIEW_TASK_NOT_FOUND':
        ElMessage.error('审核任务不存在或已被其他审核员处理');
        break;
      
      case 'REVIEW_TASK_ALREADY_RESOLVED':
        ElNotification.warning({
          title: '任务已处理',
          message: `任务 ${context} 已被其他审核员处理，请刷新列表`,
          duration: 5000,
        });
        break;
      
      case 'REVIEW_TASK_LOCKED':
        ElMessage.warning('该任务正在被其他审核员处理');
        break;
      
      case 'REVIEW_PERMISSION_DENIED':
        ElMessage.error('您没有该操作的权限');
        break;
      
      case 'REVIEW_SLA_EXPIRED':
        ElNotification.error({
          title: 'SLA超时',
          message: '该任务已超过SLA时限，已自动升级处理',
        });
        break;
      
      case 'SENSITIVE_WORD_IMPORT_FORMAT_ERROR':
        ElMessage.error('导入文件格式错误，请使用模板下载的CSV格式');
        break;
      
      case 'REVIEW_RULE_CONDITION_INVALID':
        ElMessage.error('规则条件配置无效：' + errorMsg);
        break;
      
      default:
        ElMessage.error(`操作失败：${errorMsg}`);
        // 上报前端监控
        reportError(error, { context });
    }
  }

  /**
   * 处理网络异常
   */
  static handleNetworkError(context: string) {
    ElNotification({
      title: '网络异常',
      message: `${context} - 请检查网络连接，正在自动重试...`,
      type: 'warning',
      duration: 0, // 不自动关闭
    });
    
    // 自动重试逻辑
    return new Promise(resolve => {
      setTimeout(() => resolve(true), 3000);
    });
  }
}
```

### 10.2 离线/弱网降级

| 场景 | 降级策略 |
| --- | --- |
| 任务列表加载失败 | 展示缓存的上次列表 + 重试按钮 |
| 任务详情加载失败 | 展示骨架屏 + 重试 |
| 决策提交失败 | 本地暂存决策，恢复网络后自动重试 |
| 敏感词匹配预览失败 | 提示"预览服务暂时不可用"，不阻塞保存 |
| 看板数据加载失败 | 展示空态图 + "刷新"按钮 |

### 10.3 决策提交可靠性保障

```typescript
// src/utils/decision-queue.ts
/**
 * 决策提交队列 - 保障审核决策不丢失
 * 即使网络断开，决策也会在本地排队等待恢复后提交
 */

interface QueuedDecision {
  taskId: string;
  decision: ReviewDecision;
  timestamp: number;
  retryCount: number;
}

const DECISION_QUEUE_KEY = 'review_decision_queue';
const MAX_RETRY = 3;

export class DecisionQueue {
  private queue: QueuedDecision[] = [];
  private processing = false;

  constructor() {
    this.loadFromStorage();
    // 监听网络恢复事件
    window.addEventListener('online', () => this.processQueue());
  }

  async enqueue(taskId: string, decision: ReviewDecision) {
    this.queue.push({
      taskId,
      decision,
      timestamp: Date.now(),
      retryCount: 0,
    });
    this.saveToStorage();
    await this.processQueue();
  }

  private async processQueue() {
    if (this.processing || this.queue.length === 0) return;
    if (!navigator.onLine) return;

    this.processing = true;

    while (this.queue.length > 0) {
      const item = this.queue[0];
      try {
        await reviewApi.submitDecision(item.taskId, item.decision);
        this.queue.shift();
        this.saveToStorage();
      } catch (error: any) {
        if (error?.response?.status === 409) {
          // 任务已被处理，移除队列
          this.queue.shift();
          this.saveToStorage();
        } else {
          item.retryCount++;
          if (item.retryCount >= MAX_RETRY) {
            // 超过重试次数，通知用户
            ElNotification.error({
              title: '审核决策提交失败',
              message: `任务 ${item.taskId} 的审核决策多次提交失败，请手动处理`,
              duration: 0,
            });
            this.queue.shift();
            this.saveToStorage();
          }
          break; // 等待下次重试
        }
      }
    }

    this.processing = false;
  }

  private loadFromStorage() {
    try {
      const data = localStorage.getItem(DECISION_QUEUE_KEY);
      if (data) {
        this.queue = JSON.parse(data);
        if (this.queue.length > 0) {
          this.processQueue();
        }
      }
    } catch {
      this.queue = [];
    }
  }

  private saveToStorage() {
    localStorage.setItem(DECISION_QUEUE_KEY, JSON.stringify(this.queue));
  }
}
```

---

## 11. 性能优化设计

### 11.1 列表虚拟滚动

审核任务列表可能超过 1000 条，使用虚拟滚动保证性能：

```vue
<!-- src/components/review/VirtualTaskList.vue -->
<template>
  <el-table-v2
    :data="tasks"
    :columns="columns"
    :width="tableWidth"
    :height="tableHeight"
    :row-height="60"
    :header-height="44"
    estimated-row-height="60"
    fixed
  >
    <template #empty>
      <el-empty description="暂无审核任务" />
    </template>
  </el-table-v2>
</template>
```

### 11.2 缓存策略

| 数据 | 缓存方式 | TTL | 失效策略 |
| --- | --- | --- | --- |
| 任务列表 | Pinia + sessionStorage | 30秒 | 轮询刷新 |
| 任务详情 | 内存 Map | 5分钟 | 手动刷新 |
| 敏感词列表 | IndexedDB | 10分钟 | 版本号比对 |
| 审核规则 | IndexedDB | 5分钟 | 版本号比对 |
| 拒绝原因列表 | 内存 | 应用生命周期 | 版本发布时刷新 |
| 用户信息 | Pinia | 应用生命周期 | 登出清除 |
| 看板数据 | 内存 | 5分钟 | 手动刷新 |

### 11.3 预加载策略

```typescript
// 预加载下一条任务的详情
async function preloadNextTask(currentTaskId: string) {
  const nextTask = store.myPendingTasks.find(
    (t, i, arr) => 
      i > arr.findIndex(x => x.id === currentTaskId) &&
      t.status === 'pending'
  );
  
  if (nextTask) {
    // 使用 requestIdleCallback 在空闲时预加载
    requestIdleCallback(async () => {
      await reviewApi.getTaskDetail(nextTask.id);
    });
  }
}
```

---

## 12. 安全与权限设计

### 12.1 页面级权限控制

```typescript
// src/router/guards/review-permission.ts
import type { Router } from 'vue-router';

const REVIEW_PERMISSIONS = {
  '/admin/review': 'review:access',
  '/admin/review/queue': 'review:task:list',
  '/admin/review/task': 'review:task:handle',
  '/admin/review/quality': 'review:quality:handle',
  '/admin/review/sensitive-words': 'review:sensitive:manage',
  '/admin/review/rules': 'review:rule:manage',
  '/admin/review/cases': 'review:case:manage',
  '/admin/review/appeals': 'review:appeal:handle',
  '/admin/review/team': 'review:team:manage',
  '/admin/review/logs': 'review:log:query',
};

export function setupReviewPermissionGuard(router: Router) {
  router.beforeEach((to, from, next) => {
    const requiredPermission = Object.entries(REVIEW_PERMISSIONS).find(
      ([path]) => to.path.startsWith(path)
    );
    
    if (requiredPermission) {
      const userPermissions = useUserStore().permissions;
      if (!userPermissions.includes(requiredPermission[1])) {
        next({ name: '403' });
        return;
      }
    }
    
    next();
  });
}
```

### 12.2 操作级权限控制

```typescript
// src/composables/useReviewPermission.ts
export function useReviewPermission() {
  const userStore = useUserStore();
  
  const can = {
    // 任务操作
    startReview: (task: ReviewTask) => 
      hasPermission('review:task:handle') && 
      task.status === 'pending',
    
    submitDecision: (task: ReviewTask) =>
      hasPermission('review:task:handle') &&
      task.assigneeId === userStore.userId &&
      task.status === 'in_review',
    
    transferTask: (task: ReviewTask) =>
      hasPermission('review:task:transfer') &&
      task.status === 'in_review',
    
    batchOperate: () =>
      hasPermission('review:task:batch'),
    
    // 二审
    secondReview: (task: ReviewTask) =>
      hasPermission('review:task:second_review') &&
      task.status === 'pending_second_review',
    
    // 申诉处理
    handleAppeal: (task: ReviewTask) =>
      hasPermission('review:appeal:handle') &&
      task.status === 'pending_appeal',
    
    // 敏感词管理
    manageSensitiveWords: () =>
      hasPermission('review:sensitive:manage'),
    
    // 规则管理
    manageRules: () =>
      hasPermission('review:rule:manage'),
    
    // 查看绩效
    viewTeamPerformance: () =>
      hasPermission('review:team:manage'),
  };
  
  function hasPermission(perm: string): boolean {
    return userStore.permissions.includes(perm);
  }
  
  return { can };
}
```

### 12.3 审计日志

所有审核操作均需记录审计日志：

```typescript
// 审计日志自动记录中间件（请求拦截器）
const AUDITED_ACTIONS = [
  'POST:/admin/api/v1/review/tasks/*/decision',
  'POST:/admin/api/v1/review/tasks/*/transfer',
  'POST:/admin/api/v1/review/tasks/batch',
  'POST:/admin/api/v1/review/sensitive-words',
  'PUT:/admin/api/v1/review/sensitive-words/*',
  'POST:/admin/api/v1/review/rules',
  'PUT:/admin/api/v1/review/rules/*',
];

// 后端自动记录，前端无需额外调用
// 日志格式:
// {
//   "action": "submit_decision",
//   "resource_type": "review_task",
//   "resource_id": "rvt_abc123",
//   "operator_id": "adm_001",
//   "operator_ip": "192.168.1.100",
//   "details": {
//     "decision": "block",
//     "risk_labels": ["answer_leak"],
//     "task_type": "ai_safety"
//   },
//   "user_agent": "...",
//   "created_at": "2026-07-22T14:30:00+08:00"
// }
```

---

## 13. 组件依赖清单

| 组件 | 来源 | 用途 |
| --- | --- | --- |
| `el-table-v2` | Element Plus | 虚拟滚动表格 |
| `el-radio-group` | Element Plus | 决策选择 |
| `el-checkbox-group` | Element Plus | 风险标签多选 |
| `el-cascader` | Element Plus | 敏感词分类级联选择 |
| ECharts | echarts | 数据可视化 |
| `vue-virtual-scroller` | 第三方 | 长列表虚拟滚动（备用） |
| `element-plus/icons-vue` | Element Plus | 图标 |

---

## 14. 开发任务拆分建议

| 任务 | 预估工时 | 优先级 | 依赖 |
| --- | --- | --- | --- |
| 搭建审核工作台页面框架与路由 | 2天 | P0 | 管理后台框架 |
| 审核任务列表页（含筛选、分页） | 3天 | P0 | 框架 |
| 审核任务详情页三栏布局 | 2天 | P0 | 列表页 |
| 内容展示组件（AI对话、UGC展示） | 3天 | P0 | 详情页框架 |
| 决策面板组件 | 2天 | P0 | 详情页框架 |
| 快捷键系统 | 1天 | P1 | 详情页 |
| 批量操作功能 | 2天 | P1 | 列表页 |
| 敏感词库管理页面 | 3天 | P1 | 框架 |
| 审核规则配置页面 | 2天 | P1 | 框架 |
| 数据看板页面 | 3天 | P1 | ECharts |
| AI质量质检工作台 | 3天 | P1 | 详情页组件复用 |
| 违规案例管理 | 2天 | P2 | 框架 |
| 申诉复议处理 | 2天 | P2 | 框架 |
| 审核团队与绩效 | 2天 | P2 | 看板数据 |
| 决策离线队列 | 1天 | P2 | 决策面板 |
| 操作日志查询 | 1天 | P2 | 框架 |

**总预估：约 34 人天（单人），建议 2 人并行开发，约 17 天完成。**

---

## 15. 附录

### 15.1 常用拒绝原因码表

| 代码 | 原因 | 分类 |
| --- | --- | --- |
| R_ANSWER_LEAK_01 | AI直接给出完整答案，未使用分步引导 | education |
| R_ANSWER_LEAK_02 | 考试/作业场景下直接提供答案 | education |
| R_AGE_MISMATCH_01 | 内容表达方式与目标学段不符 | education |
| R_AGE_MISMATCH_02 | 使用了超出学段认知的术语 | education |
| R_FACTUAL_ERROR_01 | AI回答中包含事实性错误 | quality |
| R_FACTUAL_ERROR_02 | 公式/计算结果错误 | quality |
| R_FACTUAL_ERROR_03 | 历史事件/人物/时间错误 | quality |
| R_SAFETY_01 | 包含暴力或恐怖内容 | safety |
| R_SAFETY_02 | 包含色情或低俗内容 | safety |
| R_SAFETY_03 | 包含政治敏感内容 | safety |
| R_SAFETY_04 | 涉及用户隐私信息 | safety |
| R_MISLEADING_01 | AI回答存在误导性信息 | quality |
| R_MISLEADING_02 | 解题方法不适用于该学段 | quality |
| R_FORMAT_01 | 公式渲染错误导致无法阅读 | quality |
| R_FORMAT_02 | 排版混乱影响理解 | quality |
| R_UPL_VIOLATION_01 | 用户上传内容包含不当图片 | safety |
| R_ADVERTISEMENT_01 | 在学习内容中植入广告 | safety |
| R_CHEATING_01 | 涉及考试作弊方法 | safety |
| R_OTHER_01 | 其他原因（需填写说明） | other |